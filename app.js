// ============================================================
// CONFIGURAÇÃO
// ============================================================
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwX8avRK6Mh3jBx7XCoUCUS1lfR0tGJBGcN68zv_WRpRMSIF3EDdC-2GkbpvoGXV-mr-Q/exec';
const SESSAO_DURACAO_H = 24;

// Firebase config
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyAv4knEI4IgKH6fRpr_3BuiuijvP2Ul2ms",
  authDomain: "calculadora-real-ecom.firebaseapp.com",
  projectId: "calculadora-real-ecom",
  storageBucket: "calculadora-real-ecom.firebasestorage.app",
  messagingSenderId: "845239286688",
  appId: "1:845239286688:web:71018a44cabee0025842c5"
};

// ============================================================
// FIREBASE — inicialização garantida
// ============================================================
let _firebaseInitialized = false;

function ensureFirebase() {
  if (_firebaseInitialized) return;
  if (!firebase.apps.length) {
    firebase.initializeApp(FIREBASE_CONFIG);
  }
  _firebaseInitialized = true;
}

let _db = null;
async function getDB() {
  ensureFirebase();
  if (_db) return _db;
  _db = firebase.firestore();
  return _db;
}

let _auth = null;
async function getAuth() {
  ensureFirebase();
  if (_auth) return _auth;
  _auth = firebase.auth();
  return _auth;
}

function loadScript(src){
  return new Promise((res,rej)=>{
    if(document.querySelector(`script[src="${src}"]`)){res();return;}
    const s=document.createElement('script');
    s.src=src;s.onload=res;s.onerror=rej;
    document.head.appendChild(s);
  });
}

// Retorna o identificador do usuário atual (email do Firebase Auth ou chave legada)
// Cache do usuário atual — evita criar múltiplos listeners
let _cachedUserId = null;
let _authResolved = false;
let _authResolveCallbacks = [];

// Chamado uma única vez pelo onAuthStateChanged global
function _setAuthUser(user) {
  _cachedUserId = (user && user.email) ? user.email : null;
  _authResolved = true;
  _authResolveCallbacks.forEach(cb => cb(_cachedUserId));
  _authResolveCallbacks = [];
}

async function getUserId() {
  ensureFirebase();

  // Já resolvido — retorna direto sem criar novo listener
  if (_authResolved) return _cachedUserId;

  // Se Firebase já tem usuário, retorna imediatamente
  const auth = firebase.auth();
  if (auth.currentUser && auth.currentUser.email) {
    return auth.currentUser.email;
  }

  // Aguarda resolução com timeout de 5s para não travar eternamente
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      // Timeout — remove callback e retorna null
      _authResolveCallbacks = _authResolveCallbacks.filter(cb => cb !== resolve);
      const s = verificarSessao();
      resolve(s ? (s.email || s.chave) : null);
    }, 5000);

    _authResolveCallbacks.push((uid) => {
      clearTimeout(timer);
      resolve(uid);
    });
  });
}

// Retorna ref do doc do usuário atual
async function userDoc(colecao){
  const uid = await getUserId();
  if(!uid) return null;
  const db=await getDB();
  return db.collection('usuarios').doc(uid).collection(colecao);
}

// Salva array no Firebase (sobrescreve a coleção com um único doc "data")
// ============================================================
// ISOLAMENTO DE DADOS POR USUÁRIO — evita vazamento entre contas
// no mesmo navegador. Chaves genéricas de localStorage eram
// compartilhadas: quem logasse depois via os dados do anterior.
// ============================================================
function localKey(baseKey){
  const uid = firebase.auth().currentUser ? firebase.auth().currentUser.email : null;
  if(!uid) return null;                     // sem usuário logado → nunca usa cache
  return baseKey + '_' + uid.replace(/[^a-zA-Z0-9]/g,'_');
}

function getCached(baseKey, fallback='[]'){
  const key = localKey(baseKey);
  if(!key) return JSON.parse(fallback);
  return JSON.parse(localStorage.getItem(key) || fallback);
}

function setCached(baseKey, dados){
  const key = localKey(baseKey);
  if(key) localStorage.setItem(key, JSON.stringify(dados));
}

const _MAPA_COLECAO = {produtos:'realecom_prods', eventos:'realecom_eventos', metas:'realecom_metas'};

async function fbSet(colecao, dados){
  try{
    const uid = await getUserId();
    if(!uid) return;
    setCached(_MAPA_COLECAO[colecao] || colecao, dados);
    const db=await getDB();
    await db.collection('usuarios').doc(uid)
      .collection(colecao).doc('data')
      .set({payload: JSON.stringify(dados), ts: Date.now()});
  }catch(e){ console.warn('Firebase write error:', e); }
}

// Lê array do Firebase, fallback para localStorage
async function fbGet(colecao, baseKey, fallback){
  try{
    const uid = await getUserId();
    if(!uid) return JSON.parse(fallback);   // sem uid → nunca usa cache
    const userKey = localKey(baseKey);
    const db=await getDB();
    const doc=await db.collection('usuarios').doc(uid)
      .collection(colecao).doc('data').get();
    if(doc.exists){
      const dados=JSON.parse(doc.data().payload);
      if(userKey) localStorage.setItem(userKey, JSON.stringify(dados));
      return dados;
    }
    if(userKey) localStorage.removeItem(userKey);
    return JSON.parse(fallback);
  }catch(e){
    console.warn('Firebase read error:', e);
    const userKey = localKey(baseKey);      // em erro de rede: cache SÓ do usuário atual
    if(userKey){
      const cached = localStorage.getItem(userKey);
      if(cached) return JSON.parse(cached);
    }
    return JSON.parse(fallback);
  }
}

// Registra atividade do usuário no Firebase (para o admin ver)
async function registrarAtividade(acao){
  try{
    const uid = await getUserId();
    if(!uid) return;
    const s=verificarSessao();
    const db=await getDB();
    // Só grava o nome se ele existir de verdade — antes, sem sessão local
    // (entrada automática), gravava nome:'' e apagava o nome da conta no Firestore.
    const reg={email: uid, ultimaAtividade: Date.now(), ultimaAcao: acao};
    if(s && s.nome && s.nome!==uid) reg.nome=s.nome;
    await db.collection('usuarios').doc(uid).set(reg,{merge:true});
  }catch(e){}
}

// ============================================================
// LOGIN — Firebase Auth (email + senha)
// ============================================================

function verificarSessao(){
  // Compatibilidade: retorna usuário do Firebase ou sessão antiga
  try{
    const s=JSON.parse(localStorage.getItem('realecom_sessao')||'null');
    if(!s)return false;
    const agora=Date.now();
    if(agora>s.expira){localStorage.removeItem('realecom_sessao');return false;}
    return s;
  }catch(e){return false;}
}

function salvarSessao(dados){
  try{
    const expira=Date.now()+(SESSAO_DURACAO_H*60*60*1000);
    localStorage.setItem('realecom_sessao',JSON.stringify({...dados,expira}));
  }catch(e){}
}

// A fonte da verdade de "está logado" é o Firebase Auth (que fica salvo no
// navegador e entra sozinho). A sessão local de 24h é só cache de nome/validade.
// Antes, a troca de página olhava SÓ a sessão local: quem entrava automático
// (Chrome/tablet) não tinha essa sessão, e cada clique recarregava o site e
// jogava a pessoa de volta pro início.
function estaLogado(){
  try{
    const u = firebase.auth().currentUser;
    if(_jaEntrou && u && u.email) return true;
  }catch(e){}
  return !!verificarSessao();
}

async function sair(){
  if(!confirm('Deseja sair da sua conta?'))return;
  const sb=document.getElementById('sidebar');
  if(sb)sb.style.display='none';
  // Pega o e-mail ANTES do signOut — depois dele currentUser já é null
  // e os caches da conta nunca eram limpos
  const _uid = firebase.auth().currentUser ? firebase.auth().currentUser.email : null;
  const _safe = _uid ? _uid.replace(/[^a-zA-Z0-9]/g,'_') : null;
  _fazendoLogout = true;
  try{const auth=await getAuth();await auth.signOut();}catch(e){}
  // Limpa TODOS os dados do usuário do localStorage ao sair
  // Evita vazamento para quem logar depois neste mesmo PC
  ['realecom_sessao','realecom_prods','realecom_eventos','realecom_metas',
   'realecom_sazonal_sel','realecom_telefone','realecom_pub_historico','realecom_ncm_hist']
   .forEach(k=>{ localStorage.removeItem(k); if(_safe) localStorage.removeItem(k+'_'+_safe); });
  localStorage.removeItem('realecom_pagina');
  // Reseta cache de auth para não usar userId do usuário anterior
  _cachedUserId = null;
  _authResolved = false;
  _jaEntrou = false;
  location.reload();
}

async function fazerLogin(){
  const email=document.getElementById('login-email').value.trim().toLowerCase();
  const senha=document.getElementById('login-senha').value;
  if(!email||!senha){mostrarErroLogin('Preencha o e-mail e a senha.');return;}

  const btn=document.getElementById('btn-login');
  const loading=document.getElementById('login-loading');
  btn.disabled=true;
  (function(){const el=document.getElementById('login-erro');if(el)el.style.display='none';})();
  (function(){const el=document.getElementById('login-validade');if(el)el.style.display='none';})();
  loading.style.display='block';

  try{
    const auth=await getAuth();
    const cred=await auth.signInWithEmailAndPassword(email,senha);
    const uid=cred.user.uid;

    // Busca dados do usuário no Firestore
    const db=await getDB();
    const doc=await db.collection('usuarios').doc(email).get();

    loading.style.display='none';

    if(!doc.exists){
      mostrarErroLogin('Conta não encontrada. Entre em contato com o suporte.');
      await auth.signOut();
      btn.disabled=false;
      return;
    }

    const dados=doc.data();

    // Verifica se está ativo e dentro do prazo
    if(!dados.ativo){
      mostrarErroLogin('Sua conta está inativa. Entre em contato com o suporte.');
      await auth.signOut();
      btn.disabled=false;
      return;
    }

    // Verifica validade
    if(dados.validade){
      const partes=dados.validade.split('/');
      const validade=new Date(partes[2],partes[1]-1,partes[0]);
      validade.setHours(23,59,59);
      if(new Date()>validade){
        mostrarErroLogin('Seu acesso expirou em '+dados.validade+'. Renove sua assinatura.');
        await auth.signOut();
        btn.disabled=false;
        return;
      }
    }

    salvarSessao({email,nome:dados.nome||email,validade:dados.validade||'—',uid});
    const el=document.getElementById('login-validade');
    el.style.display='block';
    el.textContent=`✅ Bem-vindo, ${dados.nome||email}!`;
    // NÃO chama entrarNoApp() aqui. O signInWithEmailAndPassword acima já dispara
    // o onAuthStateChanged global, que é quem entra no app — com a trava _jaEntrou
    // certa e lendo a página/dados da extensão direito. Chamar aqui TAMBÉM criava
    // uma corrida: as duas chamadas disparavam quase juntas, e a desta função
    // (900ms depois, sem saber da extensão) sempre vencia por último e jogava
    // o usuário de volta pra home — mesmo depois do preço já ter sido preenchido.

  }catch(e){
    loading.style.display='none';
    btn.disabled=false;
    const msgs={
      'auth/user-not-found':'E-mail não cadastrado.',
      'auth/wrong-password':'Senha incorreta.',
      'auth/invalid-email':'E-mail inválido.',
      'auth/too-many-requests':'Muitas tentativas. Aguarde alguns minutos.',
      'auth/invalid-credential':'E-mail ou senha incorretos.',
    };
    mostrarErroLogin(msgs[e.code]||'Erro ao entrar. Tente novamente.');
  }
}

async function esqueceuSenha(){
  const email=document.getElementById('login-email').value.trim().toLowerCase();
  if(!email){mostrarErroLogin('Digite seu e-mail acima para recuperar a senha.');return;}
  try{
    const auth=await getAuth();
    await auth.sendPasswordResetEmail(email);
    const el=document.getElementById('login-validade');
    el.style.display='block';
    el.style.background='#05291622';
    el.style.borderColor='#16a34a44';
    el.style.color='var(--in)';
    el.textContent='📧 E-mail de recuperação enviado! Verifique sua caixa de entrada.';
    (function(){const el=document.getElementById('login-erro');if(el)el.style.display='none';})();
  }catch(e){
    mostrarErroLogin('Não foi possível enviar o e-mail. Verifique se o endereço está correto.');
  }
}

function mostrarErroLogin(msg){
  const el=document.getElementById('login-erro');
  el.textContent=msg;
  el.style.display='block';
}

function entrarNoApp(dados, pagina){
  // Mostra sidebar
  const sb = document.getElementById('sidebar');
  if(sb) sb.style.display='flex';

  // Iniciais no avatar
  const elIniciais = document.getElementById('sb-iniciais');
  if(elIniciais && dados && dados.nome){
    const partes = dados.nome.trim().split(' ');
    const iniciais = partes.length>=2 ? partes[0][0]+partes[partes.length-1][0] : partes[0].substring(0,2);
    elIniciais.textContent = iniciais.toUpperCase();
  }

  const hu=document.getElementById('home-usuario');
  if(hu&&dados&&dados.nome){
    hu.innerHTML=`👋 Olá, <strong style="color:var(--o)">${dados.nome}</strong>`;
  }
  // KPIs da home
  const elVal=document.getElementById('home-kpi-validade');
  if(elVal) elVal.textContent=dados.validade&&dados.validade!=='—'?dados.validade:'Sem expiração';
  const elPlano=document.getElementById('home-kpi-plano');
  if(elPlano) elPlano.textContent=dados.plano?'Plano '+dados.plano:'Acesso liberado';

  fbGet('produtos','realecom_prods','[]').then(prods=>{
    setCached('realecom_prods',prods);

    // Dashboard KPI — total e distribuição de margem
    const elProds=document.getElementById('home-kpi-prods');
    if(elProds) elProds.textContent=prods.length;
    const elDashSub=document.getElementById('home-dash-sub');
    if(elDashSub) elDashSub.textContent=prods.length+' produto'+(prods.length!==1?'s':'')+' salvos';

    const total=prods.length||1;
    const m10=prods.filter(p=>parseFloat(p.margem)>=10&&parseFloat(p.margem)<15).length;
    const m15=prods.filter(p=>parseFloat(p.margem)>=15&&parseFloat(p.margem)<20).length;
    const m20=prods.filter(p=>parseFloat(p.margem)>=20).length;
    const setBar=(id,val,tot)=>{const el=document.getElementById(id);if(el)el.style.width=Math.round((val/tot)*100)+'%';};
    const setTxt=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=val;};
    setTxt('home-m10',m10); setBar('home-bar10',m10,total);
    setTxt('home-m15',m15); setBar('home-bar15',m15,total);
    setTxt('home-m20',m20); setBar('home-bar20',m20,total);

    // Metas KPI
    const metaObj=getCached('realecom_metas','{}');
    const prodDia=parseInt(metaObj.prodDia)||0;
    const diasSem=parseInt(metaObj.diasSemana)||0;
    if(prodDia&&diasSem){
      const agora=Date.now();
      const metaSem=prodDia*diasSem, metaMes=metaSem*4;
      const metaDia=prodDia;
      const hoje0=new Date();hoje0.setHours(0,0,0,0);
      const pDia=prods.filter(p=>p.id>=hoje0.getTime()).length;
      const pSem=prods.filter(p=>p.id>=agora-7*864e5).length;
      const pMes=prods.filter(p=>p.id>=agora-30*864e5).length;
      setTxt('home-meta-dia',`${pDia}/${metaDia}`);
      setTxt('home-meta-sem',`${pSem}/${metaSem}`);
      setTxt('home-meta-mes',`${pMes}/${metaMes}`);
      setBar('home-bar-dia',pDia,metaDia||1);
      setBar('home-bar-sem',pSem,metaSem||1);
      setBar('home-bar-mes',pMes,metaMes||1);
    }else{
      ['home-meta-dia','home-meta-sem','home-meta-mes'].forEach(id=>setTxt(id,'—'));
    }
  });
  fbGet('eventos','realecom_eventos','[]').then(evs=>{
    setCached('realecom_eventos',evs);
    // Calendário home — eventos de hoje e próximos
    const hoje=new Date();hoje.setHours(0,0,0,0);
    const hojeStr=hoje.toISOString().split('T')[0];
    const cores={full:'var(--text2)',conta:'var(--out)',entrega:'var(--in)',outro:'var(--text2)'};
    const proximos=evs.filter(e=>{
      const d=new Date(e.data+'T00:00:00');
      return d>=hoje;
    }).sort((a,b)=>a.data.localeCompare(b.data)).slice(0,3);

    const elCal=document.getElementById('home-cal-eventos');
    const elCalTit=document.getElementById('home-cal-titulo');
    if(elCalTit) elCalTit.textContent='Hoje · '+hoje.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
    if(elCal){
      if(!proximos.length){
        elCal.innerHTML='<div style="font-size:.7rem;color:var(--text3)">Nenhum evento próximo</div>';
      }else{
        elCal.innerHTML=proximos.map(e=>{
          const isHoje=e.data===hojeStr;
          const d=new Date(e.data+'T00:00:00');
          const diffDias=Math.round((d-hoje)/(864e5));
          const label=isHoje?'Hoje':diffDias===1?'Amanhã':'Em '+diffDias+' dias';
          return`<div style="display:flex;gap:6px;align-items:center">
            <div style="width:3px;height:26px;background:${cores[e.tipo]||'var(--text2)'};border-radius:2px;flex-shrink:0"></div>
            <div>
              <div style="font-size:.72rem;font-weight:600;color:var(--text)">${e.titulo}</div>
              <div style="font-size:.65rem;color:var(--text3)">${label}</div>
            </div>
          </div>`;
        }).join('');
      }
    }
  });
  fbGet('metas','realecom_metas','{}').then(m=>{
    setCached('realecom_metas',m);
  });
  registrarAtividade('login');
  inicializarPush();
  setTimeout(()=>{
    // Dados vindos da extensão do Mercado Livre (botão "Enviar para a Calculadora")
    const dadosExt = lerDadosDaExtensao();
    if(dadosExt) pagina = 'calc';

    showPage(pagina||'home', true);

    if(dadosExt){
      setTimeout(() => aplicarDadosDaExtensao(dadosExt), 200);
    } else {
      setTimeout(()=>verificarConfirmacoesSazonais(), 800);
    }
  }, 50);
}

// Verifica sessão ao carregar — baseado no Firebase Auth
// Flags globais de controle de auth — precisam ser acessíveis pelo sair()
let _fazendoLogout = false;
let _jaEntrou = false;

(function(){
  // Tema pode ser aplicado imediatamente, não depende de auth
  const t=localStorage.getItem('realecom_theme');
  if(t==='light'){document.body.classList.add('light');document.querySelectorAll('.theme-toggle').forEach(b=>b.textContent='🌙 Escuro');}

  ensureFirebase();

  firebase.auth().onAuthStateChanged(async (user) => {
    // Se estamos fazendo logout manual, ignora completamente
    if(_fazendoLogout) return;
    // Se _jaEntrou já está true, ignora disparos subsequentes (renovação de token, foco de aba)
    if(_jaEntrou && user) return;

    // Resolve o cache de userId para todas as chamadas pendentes
    _setAuthUser(user);

    if(!user){
      // Só limpa e mostra login se não estamos fazendo logout manual
      if(!_fazendoLogout){
        localStorage.removeItem('realecom_sessao');
        _jaEntrou = false;
      }
      return;
    }

    // Se já entrou no app nesta sessão, ignora disparos subsequentes do onAuthStateChanged
    // (Firebase dispara ao renovar token, ao mudar foco da aba, etc.)
    if(_jaEntrou) return;

    // Primeira vez — valida no Firestore se está ativo e dentro do prazo
    try{
      const db = await getDB();
      const doc = await db.collection('usuarios').doc(user.email).get();

      if(!doc.exists){
        _fazendoLogout = true;
        await firebase.auth().signOut();
        localStorage.removeItem('realecom_sessao');
        _fazendoLogout = false;
        return;
      }

      const dados = doc.data();

      if(!dados.ativo){
        _fazendoLogout = true;
        await firebase.auth().signOut();
        localStorage.removeItem('realecom_sessao');
        _fazendoLogout = false;
        mostrarErroLogin('Sua conta está inativa. Entre em contato com o suporte.');
        return;
      }

      if(dados.validade){
        const partes = dados.validade.split('/');
        const validade = new Date(partes[2], partes[1]-1, partes[0]);
        validade.setHours(23,59,59);
        if(new Date() > validade){
          _fazendoLogout = true;
          await firebase.auth().signOut();
          localStorage.removeItem('realecom_sessao');
          _fazendoLogout = false;
          mostrarErroLogin('Seu acesso expirou em '+dados.validade+'. Renove sua assinatura.');
          return;
        }
      }

      // Tudo ok — marca que já entrou e vai para o app
      _jaEntrou = true;
      // Carrega telefone já aqui para o banner do calendário funcionar imediatamente
      if(dados.telefone){
        setCached('realecom_telefone', dados.telefone);
      } else {
        (function(){const k=localKey('realecom_telefone');if(k)localStorage.removeItem(k);})();
      }
      const ultimaPagina = localStorage.getItem('realecom_pagina')||'home';
      const dadosSessao = {
        email: user.email,
        nome: dados.nome || user.email,
        validade: dados.validade || '—',
        plano: dados.plano || '',
        uid: user.uid
      };
      // Entrada automática (navegador já logado) também grava a sessão local —
      // antes só o login manual gravava, e a navegação quebrava.
      salvarSessao(dadosSessao);
      entrarNoApp(dadosSessao, ultimaPagina);

    }catch(e){
      console.warn('Erro ao validar sessão:', e);
      // Em caso de erro de rede, usa sessão salva como fallback
      const s = verificarSessao();
      if(s && !_jaEntrou){
        _jaEntrou = true;
        const ultimaPagina = localStorage.getItem('realecom_pagina')||'home';
        entrarNoApp({
          email: user.email,
          nome: s.nome || user.email,
          validade: s.validade || '—',
          plano: s.plano || ''
        }, ultimaPagina);
      }
    }
  });

  // Logout automático por inatividade — 2 horas sem interação
  let _timerInatividade;
  function resetarTimerInatividade(){
    clearTimeout(_timerInatividade);
    _timerInatividade = setTimeout(async ()=>{
      if(firebase.auth().currentUser){
        const _uid = firebase.auth().currentUser.email || null;
        const _safe = _uid ? _uid.replace(/[^a-zA-Z0-9]/g,'_') : null;
        _fazendoLogout = true;
        _jaEntrou = false;
        await firebase.auth().signOut();
  ['realecom_sessao','realecom_prods','realecom_eventos','realecom_metas',
   'realecom_sazonal_sel','realecom_telefone','realecom_pub_historico','realecom_ncm_hist']
   .forEach(k=>{ localStorage.removeItem(k); if(_safe) localStorage.removeItem(k+'_'+_safe); });
        _cachedUserId = null;
        _authResolved = false;
        _fazendoLogout = false;
        location.reload();
      }
    }, 2 * 60 * 60 * 1000); // 2 horas
  }
  // Reseta o timer em qualquer interação do usuário
  ['click','keydown','touchstart','scroll'].forEach(ev=>{
    document.addEventListener(ev, resetarTimerInatividade, {passive:true});
  });
  resetarTimerInatividade();
})();

// ============================================================
// APP
// ============================================================
const pesoFaixas=[[0,.3],[.3,.5],[.5,1],[1,1.5],[1.5,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,10],[10,11],[11,13],[13,15],[15,17],[17,20],[20,25],[25,30],[30,40],[40,50],[50,60],[60,70],[70,80],[80,90],[90,100],[100,125],[125,150],[150,1e9]];
const pesoLabels=['Até 0,3kg','0,3–0,5kg','0,5–1kg','1–1,5kg','1,5–2kg','2–3kg','3–4kg','4–5kg','5–6kg','6–7kg','7–8kg','8–9kg','9–10kg','10–11kg','11–13kg','13–15kg','15–17kg','17–20kg','20–25kg','25–30kg','30–40kg','40–50kg','50–60kg','60–70kg','70–80kg','80–90kg','90–100kg','100–125kg','125–150kg','+150kg'];
const precoFaixas=[0,19,49,79,100,120,150,200];
const precoLabels=['R$0–18','R$19–48','R$49–78','R$79–99','R$100–119','R$120–149','R$150–199','R$200+'];
// TABELAS DE FRETE ML — vigentes desde 02/03/2026 (verificadas 22/07/2026)
// Fonte: Central de Ajuda ML (artigos 40538, 40545, 40547) via vendedorlucrativo.com.br
// Linhas = 29 faixas de peso | Colunas = 8 faixas de preço

// Verde — MercadoLíder, reputação verde ou sem reputação (menor custo)
const T=[[5.65,6.85,8.15,12.95,14.95,16.95,19.05,21.65],[5.95,6.95,8.25,13.85,16.15,18.15,20.45,23.25],[6.05,7.15,8.45,14.45,16.85,19.05,21.35,24.45],[6.15,7.35,8.65,14.75,17.15,19.45,21.75,25.45],[6.25,7.45,8.75,15.05,17.65,19.85,22.25,25.55],[6.35,8.65,9.15,16.45,19.15,21.65,24.35,27.05],[6.45,8.75,9.75,17.85,20.75,23.35,26.35,29.25],[6.55,8.85,10.25,19.75,22.85,26.05,29.25,32.45],[6.65,8.95,10.35,25.95,29.15,33.35,36.45,40.85],[6.75,9.05,10.45,27.55,31.65,36.75,40.85,45.25],[6.85,9.25,10.55,29.45,34.35,39.25,44.15,49.35],[6.95,9.35,10.65,30.25,35.25,40.35,45.35,50.75],[7.05,9.45,10.85,38.25,45.05,51.95,58.75,65.85],[7.05,9.65,11.05,41.65,48.55,55.45,62.35,69.35],[7.15,10.05,11.45,42.55,49.75,56.85,63.85,70.95],[7.25,10.25,11.65,45.55,52.95,60.55,68.15,75.65],[7.35,10.45,11.85,48.95,56.55,64.05,71.35,79.35],[7.45,10.65,12.05,55.15,64.35,73.55,82.75,91.95],[7.65,11.05,12.25,64.55,75.75,85.45,96.25,106.85],[7.75,11.25,12.45,66.45,76.05,86.25,97.15,107.85],[7.85,11.45,12.65,68.35,79.65,89.75,100.05,107.95],[7.95,11.65,12.85,70.95,81.85,92.85,103.45,111.65],[8.05,11.85,13.05,75.55,87.25,99.05,110.25,119.05],[8.15,12.05,13.25,80.95,93.75,105.95,118.05,127.45],[8.25,12.25,13.45,84.65,97.95,110.75,123.35,133.15],[8.35,12.45,13.65,94.05,108.35,122.95,136.95,147.85],[8.45,12.65,13.85,107.45,124.85,140.45,156.45,168.85],[8.55,12.85,14.05,120.15,138.95,156.95,174.85,188.85],[8.65,12.85,14.25,127.45,147.05,166.55,185.55,200.35],[8.75,12.85,14.45,167.05,193.35,218.45,243.45,262.85]];

// Amarela — ~15% a mais nas faixas até R$78,99 e ~20% a mais acima de R$79
const T_AMA=[[6.5,7.88,9.37,15.54,17.94,20.34,22.86,25.98],[6.84,7.99,9.49,16.62,19.38,21.78,24.54,27.9],[6.96,8.22,9.72,17.34,20.22,22.86,25.62,29.34],[7.07,8.45,9.95,17.7,20.58,23.34,26.1,30.54],[7.19,8.57,10.06,18.06,21.18,23.82,26.7,30.66],[7.3,9.95,10.52,19.74,22.98,25.98,29.22,32.46],[7.42,10.06,11.21,21.42,24.9,28.02,31.62,35.1],[7.53,10.18,11.79,23.7,27.42,31.26,35.1,38.94],[7.65,10.29,11.9,31.14,34.98,40.02,43.74,49.02],[7.76,10.41,12.02,33.06,37.98,44.1,49.02,54.3],[7.88,10.64,12.13,35.34,41.22,47.1,52.98,59.22],[7.99,10.75,12.25,36.3,42.3,48.42,54.42,60.9],[8.11,10.87,12.48,45.9,54.06,62.34,70.5,79.02],[8.11,11.1,12.71,49.98,58.26,66.54,74.82,83.22],[8.22,11.56,13.17,51.06,59.7,68.22,76.62,85.14],[8.34,11.79,13.4,54.66,63.54,72.66,81.78,90.78],[8.45,12.02,13.63,58.74,67.86,76.86,85.62,95.22],[8.57,12.25,13.86,66.18,77.22,88.26,99.3,110.34],[8.8,12.71,14.09,77.46,90.9,102.54,115.5,128.22],[8.91,12.94,14.32,79.74,91.26,103.5,116.58,129.42],[9.03,13.17,14.55,82.02,95.58,107.7,120.06,129.54],[9.14,13.4,14.78,85.14,98.22,111.42,124.14,133.98],[9.26,13.63,15.01,90.66,104.7,118.86,132.3,142.86],[9.37,13.86,15.24,97.14,112.5,127.14,141.66,152.94],[9.49,14.09,15.47,101.58,117.54,132.9,148.02,159.78],[9.6,14.32,15.7,112.86,130.02,147.54,164.34,177.42],[9.72,14.55,15.93,128.94,149.82,168.54,187.74,202.62],[9.83,14.78,16.16,144.18,166.74,188.34,209.82,226.62],[9.95,14.78,16.39,152.94,176.46,199.86,222.66,240.42],[10.06,14.78,16.62,200.46,232.02,262.14,292.14,315.42]];

// Laranja/Vermelha — tabela cheia, sem desconto (~dobro do verde acima de R$79)
const T_VER=[[8.08,9.8,11.65,25.9,29.9,33.9,38.1,43.3],[8.51,9.94,11.8,27.7,32.3,36.3,40.9,46.5],[8.65,10.22,12.08,28.9,33.7,38.1,42.7,48.9],[8.79,10.51,12.37,29.5,34.3,38.9,43.5,50.9],[8.94,10.65,12.51,30.1,35.3,39.7,44.5,51.1],[9.08,12.37,13.08,32.9,38.3,43.3,48.7,54.1],[9.22,12.51,13.94,35.7,41.5,46.7,52.7,58.5],[9.37,12.66,14.66,39.5,45.7,52.1,58.5,64.9],[9.51,12.8,14.8,51.9,58.3,66.7,72.9,81.7],[9.65,12.94,14.94,55.1,63.3,73.5,81.7,90.5],[9.8,13.23,15.09,58.9,68.7,78.5,88.3,98.7],[9.94,13.37,15.23,60.5,70.5,80.7,90.7,101.5],[10.08,13.51,15.52,76.5,90.1,103.9,117.5,131.7],[10.08,13.8,15.8,83.3,97.1,110.9,124.7,138.7],[10.22,14.37,16.37,85.1,99.5,113.7,127.7,141.9],[10.37,14.66,16.66,91.1,105.9,121.1,136.3,151.3],[10.51,14.94,16.95,97.9,113.1,128.1,142.7,158.7],[10.65,15.23,17.23,110.3,128.7,147.1,165.5,183.9],[10.94,15.8,17.52,129.1,151.5,170.9,192.5,213.7],[11.08,16.09,17.8,132.9,152.1,172.5,194.3,215.7],[11.23,16.37,18.09,136.7,159.3,179.5,200.1,215.9],[11.37,16.66,18.38,141.9,163.7,185.7,206.9,223.3],[11.51,16.95,18.66,151.1,174.5,198.1,220.5,238.1],[11.65,17.23,18.95,161.9,187.5,211.9,236.1,254.9],[11.8,17.52,19.23,169.3,195.9,221.5,246.7,266.3],[11.94,17.8,19.52,188.1,216.7,245.9,273.9,295.7],[12.08,18.09,19.81,214.9,249.7,280.9,312.9,337.7],[12.23,18.38,20.09,240.3,277.9,313.9,349.7,377.7],[12.37,18.38,20.38,254.9,294.1,333.1,371.1,400.7],[12.51,18.38,20.66,334.1,386.7,436.9,486.9,525.7]];

// Tabela ativa (verde por padrão)
let freteReputacao='verde'; // 'verde' | 'amarela' | 'vermelha'
function getTabela(){return freteReputacao==='amarela'?T_AMA:freteReputacao==='vermelha'?T_VER:T;}

let pesoUsado=0,freteSel=0,freteSel_col=undefined,freteMode='manual',lastCalc=null,calcMode=1;
let calAno=new Date().getFullYear(),calMes=new Date().getMonth(),evEditId=null;

function fmt(v){return'R$ '+v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});}
function fmtKg(v){return v%1===0?v.toFixed(0)+' kg':v.toFixed(v<1?3:2)+' kg';}
function fmtP(v){return v.toFixed(2).replace('.',',')+' %';}

function showPage(p,bypassCheck){
  // Proteção: bloqueia acesso às páginas internas sem sessão
  // Nunca recarrega a página aqui: recarregar em loop era o que mandava
  // a pessoa de volta pro início a cada clique. Sem login → mostra a tela de login.
  if(p!=='login'&&!bypassCheck&&!estaLogado()){
    const sb=document.getElementById('sidebar');if(sb)sb.style.display='none';
    p='login';
  }
  const _alvo=document.getElementById('page-'+p);
  if(!_alvo)return;
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  _alvo.classList.add('active');

  // Destaca item ativo na sidebar
  document.querySelectorAll('.sb-item').forEach(b=>b.classList.remove('active'));
  const mapa={calc:'sb-calc',dash:'sb-dash',metas:'sb-metas',cal:'sb-cal',gestao:'sb-gestao',simples:'sb-simples',pub:'sb-pub',ncm:'sb-ncm',home:'sb-home',conc:'sb-conc',prompt:'sb-prompt',fin:'sb-fin',aulas:'sb-aulas'};
  if(mapa[p]){const el=document.getElementById(mapa[p]);if(el)el.classList.add('active');}

  if(p==='dash')renderDash();
  if(p==='cal'){renderCal();carregarTelefoneWhatsApp();}
  if(p==='metas')carregarMetas();
  if(p==='gestao')calcularGestao();
  if(p==='simples'){(function(){const el=document.getElementById('sn-resultado');if(el)el.style.display='none';})();(function(){const el=document.getElementById('sn-empty');if(el)el.style.display='block';})();}
  if(p==='pub'){switchPubMode('dash');renderHistoricoPublicidade();}
  if(p==='sazonal'){renderSazonalGrid();}
  if(p==='ncm'){renderHistoricoNCM();}
  if(p==='fin'){finInit();}
  if(p==='aulas'){renderAulas();}
  if(p!=='login') registrarAtividade('nav_'+p);
  // Salvar página atual para restaurar no F5
  if(p!=='login')localStorage.setItem('realecom_pagina',p);
}

function toggleTheme(){
  const isLight=document.body.classList.toggle('light');
  const label=isLight?'🌙 Escuro':'☀️ Claro';
  document.querySelectorAll('.theme-toggle').forEach(b=>b.textContent=label);
  localStorage.setItem('realecom_theme',isLight?'light':'dark');
}

function getPesoIdx(p){for(let i=0;i<pesoFaixas.length;i++)if(p<=pesoFaixas[i][1])return i;return pesoFaixas.length-1;}
function getPrecoIdx(p){let c=0;for(let i=0;i<precoFaixas.length;i++)if(p>=precoFaixas[i])c=i;return c;}

function verificarFaixaFrete(){
  const aviso=document.getElementById('frete-aviso');
  if(!aviso)return;
  if(!lastCalc||freteSel_col===undefined){aviso.style.display='none';return;}
  const colCorreta=getPrecoIdx(lastCalc.preco);
  if(freteSel_col===colCorreta){
    aviso.style.cssText='display:block;margin-top:6px;background:#05291622;border:1px solid #16a34a55;border-radius:9px;padding:8px 11px;font-size:.76rem;color:var(--in);line-height:1.5';
    aviso.textContent=`✅ Faixa correta! O preço calculado (${fmt(lastCalc.preco)}) está dentro da faixa ${precoLabels[colCorreta]}.`;
  }else{
    aviso.style.cssText='display:block;margin-top:6px;background:#7f1d1d22;border:1px solid #ef444455;border-radius:9px;padding:8px 11px;font-size:.76rem;color:var(--out);line-height:1.5';
    aviso.textContent=`⚠️ Atenção: o preço calculado (${fmt(lastCalc.preco)}) corresponde à faixa ${precoLabels[getPrecoIdx(lastCalc.preco)]}, mas você selecionou ${precoLabels[freteSel_col]}.`;
  }
}

function selFrete(col,val){freteSel=val;freteSel_col=col;renderTable(col);(function(){const el=document.getElementById('frete-badge');if(el)el.style.display='block';})();(function(){const el=document.getElementById('frete-val');if(el)el.textContent=fmt(val);})();verificarFaixaFrete();}

function calcPeso(){
  const pr=parseFloat(document.getElementById('peso').value)||0;
  const c=parseFloat(document.getElementById('comp').value)||0,l=parseFloat(document.getElementById('larg').value)||0,a=parseFloat(document.getElementById('alt').value)||0;
  const pv=(c*l*a)/6000;pesoUsado=Math.max(pr,pv);freteSel=0;freteSel_col=undefined;
  (function(){const el=document.getElementById('frete-badge');if(el)el.style.display='none';})();
  const pi=document.getElementById('peso-info'),fs=document.getElementById('frete-section');
  if(pr>0||pv>0){
    pi.style.display='flex';
    (function(){const el=document.getElementById('pi-real');if(el)el.textContent=pr>0?fmtKg(pr):'—';})();
    (function(){const el=document.getElementById('pi-vol');if(el)el.textContent=pv>0?fmtKg(pv):'—';})();
    (function(){const el=document.getElementById('pi-usado');if(el)el.textContent=fmtKg(pesoUsado)+(pv>pr&&pv>0?' (vol.)':' (real)');})();
    fs.style.display='block';renderTable(-1);
  }else{pi.style.display='none';fs.style.display='none';}
}

function renderTable(selCol){
  const pi=getPesoIdx(pesoUsado),tbl=document.getElementById('frete-table');
  let h='<thead><tr><th>Peso</th>';
  for(let c=0;c<precoLabels.length;c++)h+=`<th>${precoLabels[c]}</th>`;
  h+='</tr></thead><tbody>';
  [pi-1,pi,pi+1].filter(r=>r>=0&&r<pesoLabels.length).forEach(r=>{
    const isA=r===pi;
    h+=`<tr${isA?'':' class="dim"'}><td class="pcol">${pesoLabels[r]}${isA?' ✅':''}</td>`;
    const TAB=getTabela();
    for(let c=0;c<precoLabels.length;c++){
      const sel=isA&&c===selCol,v=TAB[r][c].toFixed(2).replace('.',',');
      h+=isA?`<td class="fopt${sel?' fsel':''}" onclick="selFrete(${c},${TAB[r][c]})">R$${v}</td>`:`<td>R$${v}</td>`;
    }
    h+='</tr>';
  });
  tbl.innerHTML=h+'</tbody>';
}

function switchFrete(mode){
  freteMode=mode;
  const td=document.getElementById('tab-dim'); if(td)td.style.display=mode==='dim'?'block':'none';
  const tm=document.getElementById('tab-manual'); if(tm)tm.style.display=mode==='manual'?'block':'none';
  const bd=document.getElementById('btn-dim'); if(bd)bd.className='toggle-btn'+(mode==='dim'?' active':'');
  const bm=document.getElementById('btn-manual'); if(bm)bm.className='toggle-btn'+(mode==='manual'?' active':'');
}

// Toggle Frete Full visível
let _freteFullVisivel = false;
function toggleFreteFullVisivel(){
  _freteFullVisivel = !_freteFullVisivel;
  const panel = document.getElementById('frete-full-panel');
  const tog = document.getElementById('toggle-frete-full');
  const dot = document.getElementById('toggle-frete-full-dot');
  if(panel) panel.style.display = _freteFullVisivel ? 'block' : 'none';
  if(tog) tog.style.background = _freteFullVisivel ? '#7c3aed' : 'var(--border)';
  if(dot) dot.style.left = _freteFullVisivel ? '16px' : '2px';
  if(!_freteFullVisivel){
    const ff = document.getElementById('frete-full');
    const ffq = document.getElementById('frete-full-qtd');
    const ffr = document.getElementById('frete-full-result');
    if(ff) ff.value='';
    if(ffq) ffq.value='';
    if(ffr) ffr.style.display='none';
  }
}
function sumItems(){return[...document.querySelectorAll('.item-input')].reduce((s,e)=>s+(parseFloat(e.value)||0),0);}
function addItem(){
  const list=document.getElementById('items-list');if(list.children.length>=10)return;
  const n=list.children.length+1,d=document.createElement('div');d.className='item-row';
  d.innerHTML=`<input type="number" class="item-input" placeholder="Custo item ${n} (R$)" min="0" step="0.01"><button class="remove-btn" onclick="removeItem(this)" style="display:flex">×</button>`;
  list.appendChild(d);list.children[0].querySelector('.remove-btn').style.display='flex';
}
function removeItem(btn){btn.parentElement.remove();const rows=document.querySelectorAll('.item-row');if(rows.length===1)rows[0].querySelector('.remove-btn').style.display='none';}

function setMode(m){
  calcMode=m;
  const b1=document.getElementById('mode-btn-1'),b2=document.getElementById('mode-btn-2');
  const mb=document.getElementById('margem-block');
  const mlInput=document.getElementById('preco-ml'),mlLabel=document.getElementById('ml-label');
  if(m===1){
    b1.style.background='linear-gradient(135deg,#6B21A8,#F0A070)';b1.style.color='#fff';
    b2.style.background='none';b2.style.color='#4a3f6b';
    mb.style.display='block';mlInput.placeholder='Obrigatório';
    mlLabel.innerHTML='💛 Preço Médio ML (R$) <span style="color:var(--out);font-size:.65rem">(obrigatório)</span>';
    (function(){const el=document.getElementById('mode-desc');if(el)el.innerHTML='<strong style="color:var(--text3)">Modo Por Margem:</strong> Defina sua margem e descubra o preço mínimo ideal.';})();
    (function(){const el=document.getElementById('price-grid');if(el)el.style.gridTemplateColumns='1fr 1fr';})();
    (function(){const el=document.getElementById('pc-ml-card');if(el)el.style.display='block';})();
  }else{
    b2.style.background='linear-gradient(135deg,#6B21A8,#F0A070)';b2.style.color='#fff';
    b1.style.background='none';b1.style.color='#4a3f6b';
    mb.style.display='none';mlInput.placeholder='Obrigatório';
    mlLabel.innerHTML='💛 Preço Médio ML (R$) <span style="color:var(--out)">*</span>';
    (function(){const el=document.getElementById('mode-desc');if(el)el.innerHTML='<strong style="color:var(--text3)">Modo Pelo Mercado:</strong> Informe o preço médio ML e descubra sua margem real.';})();
  }
}

function calcular(){
  try{
    _calcularInterno();
  }catch(e){
    console.error('Erro em calcular():', e);
    // Extrai a primeira linha do stack que aponta para app.js — mostra a linha exata do erro
    const linha = (e.stack||'').split('\n').map(l=>l.trim()).find(l=>l.includes('app.js'));
    mostrarErroTela('Não foi possível calcular. ' + (e.message||'') + (linha?' — ['+linha.replace(/^at\s*/,'')+']':''));
  }
}

function _calcularInterno(){
  const custo=sumItems();
  const frete=freteMode==='manual'?(parseFloat(document.getElementById('frete-manual').value)||0):freteSel;
  // Frete de coleta Full por unidade
  const freteFullTotal=parseFloat(document.getElementById('frete-full').value)||0;
  const freteFullQtd=parseInt(document.getElementById('frete-full-qtd').value)||1;
  const freteFullUnit=freteFullTotal>0?freteFullTotal/freteFullQtd:0;
  const ins=(parseFloat(document.getElementById('insumos').value)||0)+freteFullUnit;
  const pI=(parseFloat(document.getElementById('impostos').value)||0)/100;
  const pC=(parseFloat(document.getElementById('comissao').value)||0)/100;
  const pA=(parseFloat(document.getElementById('afiliados').value)||0)/100;
  const pM=(parseFloat(document.getElementById('margem').value)||0)/100;
  const qtd=parseInt(document.getElementById('quantidade').value)||1;
  const precoML=parseFloat(document.getElementById('preco-ml').value)||0;
  const base=custo+frete+ins;

  if(calcMode===2){
    if(!precoML){alert('No Modo Pelo Mercado, informe o Preço Médio ML.');return;}
    const vI=precoML*pI,vC=precoML*pC,vA=precoML*pA;
    const payout=precoML-base-vI-vC-vA;
    const margemReal=(payout/precoML)*100;
    const markup=custo>0?precoML/custo:0;
    const inv=custo*qtd,roi=inv>0?(payout*qtd/inv)*100:0;
    lastCalc={preco:precoML,base,pI,pC,pA,pM:margemReal/100,custo,frete,ins,freteFullUnit,qtd,precoML,markup,roi,payout,inv};
    (function(){const el=document.getElementById('price-grid');if(el)el.style.gridTemplateColumns='1fr';})();
    (function(){const el=document.getElementById('pc-ml-card');if(el)el.style.display='none';})();
    const _tag2=document.querySelector('.price-card.calc .pc-tag'); if(_tag2)_tag2.textContent='Preço Médio do Mercado';
    (function(){const el=document.getElementById('pc-preco');if(el)el.textContent=fmt(precoML);})();
    (function(){const el=document.getElementById('pc-mk');if(el)el.textContent=markup.toFixed(2).replace('.',',');})();
    (function(){const el=document.getElementById('pc-roi');if(el)el.textContent=fmtP(roi);})();
    (function(){const el=document.getElementById('pc-mg');if(el)el.textContent=fmtP(margemReal);})();
    const badge=document.querySelector('.price-card.calc .pc-badge')||document.createElement('span');
    badge.textContent=margemReal>=10?'✅ Margem saudável':margemReal>=0?'⚠️ Margem baixa':'❌ Prejuízo';
    badge.style.cssText=`display:inline-block;padding:3px 10px;border-radius:20px;font-size:.67rem;font-weight:700;margin-bottom:9px;background:${margemReal>=10?'rgba(74,222,128,.2)':margemReal>=0?'rgba(240,160,112,.2)':'rgba(239,68,68,.2)'};color:${margemReal>=10?'var(--in)':margemReal>=0?'var(--text2)':'var(--out)'}`;
    const fator15=1-0.15-pI-pC-pA;
    const custoMax15=fator15>0?(precoML*fator15-frete-ins):null;
    (function(){const el=document.getElementById('explain-text');if(el)el.innerHTML=`Vendendo a <strong style="color:var(--o)">${fmt(precoML)}</strong>, sua margem real seria <strong style="color:${margemReal>=10?'var(--in)':margemReal>=0?'var(--text2)':'var(--out)'}">${fmtP(margemReal)}</strong>. ${margemReal<0?'Você está vendendo com <strong style="color:var(--out)">prejuízo</strong>.':margemReal<10?'Margem abaixo de 10% — avalie se vale a pena.':'Margem dentro de um bom patamar.'}<br><br>💡 Para ter 15% de margem vendendo a ${fmt(precoML)}, compre por no máximo <strong style="color:${custoMax15!==null&&custoMax15>0?'var(--in)':'var(--out)'}">${custoMax15!==null&&custoMax15>0?fmt(custoMax15):'Inviável com os custos atuais'}</strong>.`;})();
    if(pesoUsado>0&&freteMode==='dim'){renderTable(getPrecoIdx(precoML));verificarFaixaFrete();}
    preencherDetalhes(custo,frete,ins,base,vI,vC,vA,0,precoML,payout,qtd,inv,vI*qtd);
    (function(){const el=document.getElementById('bottom-wrapper');if(el)el.style.display='flex';})();
    finalizarCalculo();return;
  }

  const fator=1-pI-pC-pA-pM;
  if(fator<=0){alert('A soma dos percentuais é ≥ 100%. Revise os valores.');return;}
  const preco=base/fator;
  if(pesoUsado>0&&freteMode==='dim'){renderTable(getPrecoIdx(preco));verificarFaixaFrete();}
  const vI=preco*pI,vC=preco*pC,vA=preco*pA,vM=preco*pM;
  const payout=preco-base-vI-vC-vA,markup=custo>0?preco/custo:0;
  const inv=custo*qtd,roi=inv>0?(payout*qtd/inv)*100:0;
  lastCalc={preco,base,pI,pC,pA,pM,custo,frete,ins,freteFullUnit,qtd,precoML,markup,roi,payout,inv};

  (function(){const el=document.getElementById('price-grid');if(el)el.style.gridTemplateColumns='1fr 1fr';})();
  const _tag1=document.querySelector('.price-card.calc .pc-tag'); if(_tag1)_tag1.textContent='Preço Ideal Calculado';
  const mainBadge=document.querySelector('.price-card.calc .pc-badge')||document.createElement('span');
  mainBadge.textContent='✅ Preço mínimo seguro';
  mainBadge.style.cssText='display:inline-block;padding:3px 10px;border-radius:20px;background:rgba(74,222,128,.2);color:var(--in);font-size:.67rem;font-weight:700;margin-bottom:9px';
  (function(){const el=document.getElementById('pc-preco');if(el)el.textContent=fmt(preco);})();
  (function(){const el=document.getElementById('pc-mk');if(el)el.textContent=markup.toFixed(2).replace('.',',');})();
  (function(){const el=document.getElementById('pc-roi');if(el)el.textContent=fmtP(roi);})();
  (function(){const el=document.getElementById('pc-mg');if(el)el.textContent=fmtP(pM*100);})();

  const mlCard=document.getElementById('pc-ml-card');mlCard.style.display='block';
  if(precoML>0){
    const mlvI=precoML*pI,mlvC=precoML*pC,mlvA=precoML*pA;
    const mlPayout=precoML-base-mlvI-mlvC-mlvA;
    const mlMarkup=custo>0?precoML/custo:0,mlRoi=inv>0?(mlPayout*qtd/inv)*100:0,mlMargem=(mlPayout/precoML)*100;
    (function(){const el=document.getElementById('pc-ml-preco');if(el)el.textContent=fmt(precoML);})();
    (function(){const el=document.getElementById('ml-mk');if(el)el.textContent=mlMarkup.toFixed(2).replace('.',',');})();
    (function(){const el=document.getElementById('ml-roi');if(el)el.textContent=fmtP(mlRoi);})();
    (function(){const el=document.getElementById('ml-mg');if(el)el.textContent=fmtP(mlMargem);})();
    (function(){const el=document.getElementById('pc-ml-kpis');if(el)el.style.opacity='1';})();
    const diff=precoML-preco,pct=Math.abs((diff/preco)*100).toFixed(1);
    if(Math.abs(diff)<0.01){
      mlCard.className='price-card ml-equal';
      (function(){const el=document.getElementById('pc-ml-badge');if(el)el.style.cssText='display:inline-block;padding:3px 10px;border-radius:20px;background:rgba(139,92,246,.25);color:#c4b5fd;font-size:.67rem;font-weight:700;margin-bottom:9px';})();
      (function(){const el=document.getElementById('pc-ml-badge');if(el)el.textContent='= Igual ao preço calculado';})();
      (function(){const el=document.getElementById('pc-ml-tag');if(el)el.textContent='💛 Preço Médio ML';})();
      (function(){const el=document.getElementById('explain-text');if(el)el.innerHTML=`Preço médio ML igual ao seu preço mínimo. Você pode vender nesse valor mantendo a margem definida.`;})();
    }else if(diff>0){
      mlCard.className='price-card ml-cheaper';
      (function(){const el=document.getElementById('pc-ml-badge');if(el)el.style.cssText='display:inline-block;padding:3px 10px;border-radius:20px;background:rgba(74,222,128,.2);color:var(--in);font-size:.67rem;font-weight:700;margin-bottom:9px';})();
      (function(){const el=document.getElementById('pc-ml-badge');if(el)el.textContent=`✅ ${pct}% acima do seu mínimo`;})();
      (function(){const el=document.getElementById('pc-ml-tag');if(el)el.textContent='💛 Preço Médio ML';})();
      (function(){const el=document.getElementById('explain-text');if(el)el.innerHTML=`O mercado paga <strong style="color:var(--in)">${pct}% a mais</strong> que seu preço mínimo. Você pode ser mais competitivo ou vender no preço médio e aumentar a margem.`;})();
    }else{
      mlCard.className='price-card ml-pricier';
      (function(){const el=document.getElementById('pc-ml-badge');if(el)el.style.cssText='display:inline-block;padding:3px 10px;border-radius:20px;background:rgba(239,68,68,.2);color:var(--out);font-size:.67rem;font-weight:700;margin-bottom:9px';})();
      (function(){const el=document.getElementById('pc-ml-badge');if(el)el.textContent=`⚠️ ${pct}% abaixo do seu mínimo`;})();
      (function(){const el=document.getElementById('pc-ml-tag');if(el)el.textContent='⚠️ Preço Médio ML';})();
      const custoIdeal=precoML*fator-frete-ins;
      (function(){const el=document.getElementById('explain-text');if(el)el.innerHTML=`Preço médio ML está <strong style="color:var(--out)">${pct}% abaixo</strong> do seu mínimo. Para vender a ${fmt(precoML)} com a mesma margem, compre por no máximo <strong style="color:var(--in)">${fmt(Math.max(custoIdeal,0))}</strong>.`;})();
    }
    (function(){const el=document.getElementById('bottom-wrapper');if(el)el.style.display='flex';})();
  }else{
    mlCard.className='price-card ml-none';
    (function(){const el=document.getElementById('pc-ml-preco');if(el)el.textContent='—';})();
    (function(){const el=document.getElementById('pc-ml-badge');if(el)el.style.cssText='display:inline-block;padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.08);color:var(--text2);font-size:.67rem;font-weight:700;margin-bottom:9px';})();
    (function(){const el=document.getElementById('pc-ml-badge');if(el)el.textContent='Informe o preço médio';})();
    (function(){const el=document.getElementById('pc-ml-kpis');if(el)el.style.opacity='.25';})();
    ['ml-mk','ml-roi','ml-mg'].forEach(id=>document.getElementById(id).textContent='—');
    (function(){const el=document.getElementById('explain-text');if(el)el.innerHTML=`Este é o menor preço que cobre todos os seus custos com a margem definida. Informe o <strong style="color:var(--o)">Preço Médio ML</strong> para ver o comparativo.`;})();
    (function(){const el=document.getElementById('bottom-wrapper');if(el)el.style.display='none';})();
  }

  const alertBox=document.getElementById('frete-alert-box');
  if(pesoUsado>0&&freteMode==='dim'){
    const piAtual=getPesoIdx(pesoUsado),ciAtual=getPrecoIdx(preco);
    let alerta=null;
    for(let ci=ciAtual-1;ci>=0;ci--){
      const freteNovo=T[piAtual][ci],limitePreco=precoFaixas[ci+1]-0.01;
      const baseNova=custo+freteNovo+ins,precoMinNovo=baseNova/fator;
      if(precoMinNovo<=limitePreco){alerta={freteNovo,limitePreco,ganhoFrete:frete-freteNovo};break;}
    }
    if(alerta){alertBox.style.display='block';(function(){const el=document.getElementById('frete-alert-content');if(el)el.innerHTML=`<div class="brow"><span class="bl">Frete atual</span><span class="br" style="color:var(--out)">${fmt(frete)}</span></div><div class="brow"><span class="bl">Frete vendendo até ${fmt(alerta.limitePreco)}</span><span class="br" style="color:var(--in)">${fmt(alerta.freteNovo)}</span></div><div class="brow total"><span class="bl">Economia</span><span class="br" style="color:var(--in)">${fmt(alerta.ganhoFrete)}</span></div><div style="margin-top:8px;font-size:.78rem;color:var(--text2)">Vendendo por até <strong style="color:var(--o)">${fmt(alerta.limitePreco)}</strong> seu frete cai <strong style="color:var(--in)">${fmt(alerta.ganhoFrete)}</strong>.</div>`;})();}
    else{alertBox.style.display='none';}
  }else{alertBox.style.display='none';}

  preencherDetalhes(custo,frete,ins,base,vI,vC,vA,vM,preco,payout,qtd,inv,vI*qtd);
  finalizarCalculo();
}

function preencherDetalhes(custo,frete,ins,base,vI,vC,vA,vM,preco,payout,qtd,inv,totalImp){
  (function(){const el=document.getElementById('bd-custo');if(el)el.textContent=fmt(custo);})();
  (function(){const el=document.getElementById('bd-frete');if(el)el.textContent=fmt(frete);})();
  const freteFullUnit=lastCalc&&lastCalc.freteFullUnit||0;
  const insSemFull=ins-freteFullUnit;
  const elBdFull=document.getElementById('bd-frete-full');
  const elBdFullRow=document.getElementById('bd-frete-full-row');
  if(elBdFull&&elBdFullRow){
    if(freteFullUnit>0){elBdFull.textContent=fmt(freteFullUnit);elBdFullRow.style.display='flex';}
    else{elBdFullRow.style.display='none';}
  }
  (function(){const el=document.getElementById('bd-outros');if(el)el.textContent=fmt(insSemFull>0?insSemFull:ins);})();
  (function(){const el=document.getElementById('bd-base');if(el)el.textContent=fmt(base);})();
  (function(){const el=document.getElementById('bd-imp');if(el)el.textContent=fmt(vI);})();
  (function(){const el=document.getElementById('bd-com');if(el)el.textContent=fmt(vC);})();
  (function(){const el=document.getElementById('bd-afi');if(el)el.textContent=fmt(vA);})();
  (function(){const el=document.getElementById('bd-mar');if(el)el.textContent=fmt(vM);})();
  (function(){const el=document.getElementById('bd-preco');if(el)el.textContent=fmt(preco);})();

  // Projeção — Preço Calculado
  (function(){const el=document.getElementById('proj-qtd');if(el)el.textContent=qtd;})();
  (function(){const el=document.getElementById('proj-cu');if(el)el.textContent=fmt(custo);})();
  (function(){const el=document.getElementById('proj-inv');if(el)el.textContent=fmt(inv);})();
  (function(){const el=document.getElementById('proj-imp');if(el)el.textContent=fmt(totalImp);})();
  (function(){const el=document.getElementById('proj-fat');if(el)el.textContent=fmt(preco*qtd);})();
  (function(){const el=document.getElementById('proj-pay');if(el)el.textContent=fmt(payout);})();
  // payout aqui = margem em R$ (já subtraiu custo+frete+ins)
  // Payout REAL ML = preco - totalImp(vI) - vC*preco - vA*preco = o que cai na conta
  // Como preencherDetalhes recebe vI,vC,vA e preco, calcular aqui:
  const elPD=document.getElementById('proj-payout-destaque');
  if(elPD){
    // Payout ML = preço - impostos - comissão ML - afiliados - frete entrega
    // O ML desconta todos esses do repasse antes de depositar
    // Payout ML = preço − comissão ML − afiliados − frete
    // Imposto (vI) NÃO é descontado pelo ML — é recolhido separadamente pelo vendedor
    const payoutReal=preco-vC-vA-frete;
    elPD.textContent=fmt(payoutReal);
    elPD.style.color=payoutReal>=0?'var(--text2)':'var(--out)';
  }
  (function(){const el=document.getElementById('proj-lb');if(el)el.textContent=fmt(payout*qtd);})();
  setTimeout(function(){ marcarAmarelo(['proj-lb']); },0);
  (function(){const el=document.getElementById('proj-cx-bruto');if(el)el.textContent=fmt(inv+payout*qtd+totalImp);})();
  (function(){const el=document.getElementById('proj-cx');if(el)el.textContent=fmt(inv+payout*qtd);})();

  // Projeção — Preço Médio ML (grid 3 colunas)
  const precoML=lastCalc&&lastCalc.precoML||0;
  const header=document.getElementById('proj-header-ml');
  const simple=document.getElementById('proj-simple');
  const double=document.getElementById('proj-double');

  if(precoML>0){
    const mlvI=precoML*(lastCalc.pI||0),mlvC=precoML*(lastCalc.pC||0),mlvA=precoML*(lastCalc.pA||0);
    const mlPayout=precoML-custo-frete-ins-mlvI-mlvC-mlvA;
    const mlImp=mlvI*qtd;

    if(header)header.style.display='block';
    if(simple)simple.style.display='none';
    if(double)double.style.display='block';

    const s=id=>document.getElementById(id);
    const set=(id,txt)=>{const el=s(id);if(el)el.textContent=txt;};
    // Coluna A — Preço Margem
    set('pd-cu-a',fmt(custo));
    set('pd-inv-a',fmt(inv));
    set('pd-imp-a',fmt(totalImp));
    set('pd-fat-a',fmt(preco*qtd));
    set('pd-pay-a',fmt(payout));
    set('pd-cx-bruto-a',fmt(inv+payout*qtd+totalImp));
    set('pd-cx-a',fmt(inv+payout*qtd));
    set('pd-lb-a',fmt(payout*qtd));
    // Coluna B — Preço Médio
    set('pd-cu-b',fmt(custo));
    set('pd-inv-b',fmt(inv));
    set('pd-imp-b',fmt(mlImp));
    set('pd-fat-b',fmt(precoML*qtd));
    const elPayB=s('pd-pay-b');
    if(elPayB){elPayB.textContent=fmt(mlPayout);elPayB.style.color=mlPayout>=0?'var(--text2)':'var(--out)';}
    set('pd-cx-bruto-b',fmt(inv+mlPayout*qtd+mlImp));
    set('pd-cx-b',fmt(inv+mlPayout*qtd));
    const elLbB=s('pd-lb-b');
    if(elLbB){elLbB.textContent=fmt(mlPayout*qtd);}
    setTimeout(function(){ marcarAmarelo(['pd-lb-a','pd-lb-b']); },0);
    // Payout destacado por cenário
    // Payout REAL ML = preço - comissões ML (o que cai na conta antes de pagar custos)
    // lastCalc.preco = preço calculado, payout da variável local = margem em R$ (já subtrai custo+frete)
    // Payout real cenário A = preco - vI - vC - vA
    // Payout real = preço - impostos - comissão - afiliados - frete
    const payoutRealA = preco - vC - vA - frete;
    // Cenário B usa o mesmo frete físico do produto
    const payoutRealB = precoML - mlvC - mlvA - frete;
    const elPA=s('pd-payout-destaque-a');
    if(elPA){elPA.textContent=fmt(payoutRealA);elPA.style.color=payoutRealA>=0?'var(--text2)':'var(--out)';}
    const elPB=s('pd-payout-destaque-b');
    if(elPB){elPB.textContent=fmt(payoutRealB);elPB.style.color=payoutRealB>=0?'var(--in)':'var(--out)';}
  }else{
    if(header)header.style.display='none';
    if(simple)simple.style.display='block';
    if(double)double.style.display='none';
  }
}

function finalizarCalculo(){
  (function(){const el=document.getElementById('right-empty');if(el)el.style.display='none';})();
  (function(){const el=document.getElementById('right-result');if(el)el.style.display='block';})();
  try{ renderResultadoHero(); }catch(e){ console.warn('hero:', e); }
  
  // Mostrar caixa de devolução
  if(lastCalc&&lastCalc.payout>0){
    calcDevolucao();
  }

  rolarParaResultado();
}

// Depois de calcular, leva a pessoa para o início do resultado.
// No celular (colunas empilhadas), rola a página inteira para o topo.
// No desktop (colunas lado a lado), rola só o painel de resultado.
function rolarParaResultado(){
  try{
    const ehMobile = window.innerWidth <= 900;
    if(ehMobile){
      const pagina = document.querySelector('#page-calc.active') || document.getElementById('page-calc');
      if(pagina) pagina.scrollIntoView({behavior:'smooth', block:'start'});
      window.scrollTo({top:0, behavior:'smooth'});
    }else{
      const painel = document.getElementById('right-result');
      if(painel) painel.scrollIntoView({behavior:'smooth', block:'start'});
    }
  }catch(e){ console.warn('rolarParaResultado:', e); }
}

function resetar(preservarEdicao){
  // Reseta modo edição — CRÍTICO: sem isso, salvar após "Novo Cálculo" atualiza o produto anterior.
  // Exceção: verNaCalculadora() chama resetar(true) só para limpar os campos antes de
  // repovoar com o snapshot do produto — nesse caso o modo edição não pode ser apagado,
  // senão "Atualizar produto" nunca mais funciona depois de abrir um produto salvo.
  if(!preservarEdicao){
    _prodEditId = null;
    const btnAtualizar = document.getElementById('btn-atualizar');
    const btnSalvar = document.getElementById('btn-salvar-prod');
    if(btnAtualizar) btnAtualizar.style.display = 'none';
    if(btnSalvar) btnSalvar.style.display = '';
  }
  // Limpa campos do save-card
  ['save-nome','save-forn','save-cod','save-obs','save-link1','save-link2','save-link3']
    .forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  // Fecha seção de links
  const linksDiv = document.getElementById('links-anuncio');
  if(linksDiv) linksDiv.style.display = 'none';

  // Limpa painel direito
  (function(){const el=document.getElementById('right-empty');if(el)el.style.display='flex';})();
  (function(){const el=document.getElementById('right-result');if(el)el.style.display='none';})();
  (function(){const el=document.getElementById('bottom-wrapper');if(el)el.style.display='none';})();

  // Custo dos produtos — reseta para 1 item vazio
  const list=document.getElementById('items-list');
  list.innerHTML='<div class="item-row"><input type="number" class="item-input" placeholder="Custo item 1 (R$)" min="0" step="0.01"><button class="remove-btn" onclick="removeItem(this)">×</button></div>';

  // Frete por dimensões
  ['peso','comp','larg','alt'].forEach(id=>{document.getElementById(id).value='';});
  (function(){const el=document.getElementById('peso-info');if(el)el.style.display='none';})();
  (function(){const el=document.getElementById('frete-section');if(el)el.style.display='none';})();
  (function(){const el=document.getElementById('frete-badge');if(el)el.style.display='none';})();
  (function(){const el=document.getElementById('frete-aviso');if(el)el.style.display='none';})();

  // Frete manual
  document.getElementById('frete-manual').value='';

  // Insumos e Full
  document.getElementById('insumos').value='';
  document.getElementById('frete-full').value='';
  document.getElementById('frete-full-qtd').value='';
  (function(){const el=document.getElementById('frete-full-result');if(el)el.style.display='none';})();
  // Reset toggle frete full
  _freteFullVisivel = false;
  const _panel = document.getElementById('frete-full-panel');
  const _tog = document.getElementById('toggle-frete-full');
  const _dot = document.getElementById('toggle-frete-full-dot');
  if(_panel) _panel.style.display='none';
  if(_tog) _tog.style.background='var(--border)';
  if(_dot) _dot.style.left='2px';

  // Taxas
  document.getElementById('impostos').value='';
  document.getElementById('comissao').value='';
  document.getElementById('afiliados').value='';
  document.getElementById('margem').value='';

  // Projeção
  document.getElementById('quantidade').value='';
  document.getElementById('preco-ml').value='';

  // Frete reverso e ranqueamento
  document.getElementById('dev-taxa').value='';
  document.getElementById('rank-preco').value='';
  document.getElementById('rank-qtd').value='';
  (function(){const el=document.getElementById('rank-resultado');if(el)el.style.display='none';})();

  // Reset variáveis globais
  pesoUsado=0;freteSel=0;freteSel_col=undefined;lastCalc=null;
}

// ID do produto sendo editado (null = novo produto)
let _prodEditId = null;

// Atualiza produto existente no dashboard
async function atualizarProduto(){
  if(!lastCalc||!_prodEditId) return;
  const nome=document.getElementById('save-nome').value.trim();
  if(!nome){alert('Informe o nome do produto.');return;}
  const fator=1-lastCalc.pI-lastCalc.pC-lastCalc.pA-lastCalc.pM;
  const custoIdeal=lastCalc.precoML>0&&lastCalc.precoML<lastCalc.preco?(lastCalc.precoML*fator-lastCalc.frete-lastCalc.ins):null;
  let margemML=null;
  if(lastCalc.precoML>0){
    const mlPayout=lastCalc.precoML-lastCalc.base-lastCalc.precoML*lastCalc.pI-lastCalc.precoML*lastCalc.pC-lastCalc.precoML*lastCalc.pA;
    margemML=(mlPayout/lastCalc.precoML)*100;
  }
  const snapshot={
    calcMode,itens:[...(document.querySelectorAll('.item-input')||[])].map(el=>parseFloat(el.value)||0).filter(v=>v>0),
    freteMode,freteSel,freteSel_col,freteManual:parseFloat(document.getElementById('frete-manual').value)||0,
    peso:parseFloat(document.getElementById('peso').value)||0,comp:parseFloat(document.getElementById('comp').value)||0,
    larg:parseFloat(document.getElementById('larg').value)||0,alt:parseFloat(document.getElementById('alt').value)||0,
    insumos:parseFloat(document.getElementById('insumos').value)||0,
    freteFullTotal:parseFloat(document.getElementById('frete-full').value)||0,freteFullQtd:parseInt(document.getElementById('frete-full-qtd').value)||1,
    impostos:parseFloat(document.getElementById('impostos').value)||0,comissao:parseFloat(document.getElementById('comissao').value)||0,
    afiliados:parseFloat(document.getElementById('afiliados').value)||0,margem:parseFloat(document.getElementById('margem').value)||0,
    quantidade:parseInt(document.getElementById('quantidade').value)||1,precoML:parseFloat(document.getElementById('preco-ml').value)||0,
  };
  const link1=document.getElementById('save-link1')?document.getElementById('save-link1').value.trim():'';
  const link2=document.getElementById('save-link2')?document.getElementById('save-link2').value.trim():'';
  const link3=document.getElementById('save-link3')?document.getElementById('save-link3').value.trim():'';

  const prods=await fbGet('produtos','realecom_prods','[]');
  const idx=prods.findIndex(p=>p.id===_prodEditId);
  if(idx===-1){alert('Produto não encontrado. Salve como novo.');return;}
  prods[idx]={...prods[idx],nome,forn:document.getElementById('save-forn').value.trim()||'—',cod:document.getElementById('save-cod').value.trim()||'—',obs:document.getElementById('save-obs').value.trim(),link1,link2,link3,custoReal:lastCalc.custo,custoIdeal,precoCalc:lastCalc.preco,precoML:lastCalc.precoML,markup:lastCalc.markup,roi:lastCalc.roi,margem:lastCalc.pM*100,margemML,payout:lastCalc.payout,frete:lastCalc.frete,ins:lastCalc.ins,pI:lastCalc.pI,pC:lastCalc.pC,pA:lastCalc.pA,snapshot};
  setCached('realecom_prods',prods);
  fbSet('produtos',prods);
  _prodEditId=null;
  (function(){const el=document.getElementById('btn-atualizar');if(el)el.style.display='none';})();
  (function(){const el=document.getElementById('btn-salvar-prod');if(el)el.style.display='';})();
  alert('✅ Produto atualizado no Dashboard!');
}

async function salvarProduto(){
  if(!lastCalc)return;
  const nome=document.getElementById('save-nome').value.trim();
  if(!nome){alert('Informe o nome do produto.');return;}
  const fator=1-lastCalc.pI-lastCalc.pC-lastCalc.pA-lastCalc.pM;
  const custoIdeal=lastCalc.precoML>0&&lastCalc.precoML<lastCalc.preco?(lastCalc.precoML*fator-lastCalc.frete-lastCalc.ins):null;

  // Captura todos os inputs para restaurar o cálculo depois
  const snapshot={
    calcMode,
    itens:[...(document.querySelectorAll('.item-input')||[])].map(el=>parseFloat(el.value)||0).filter(v=>v>0),
    freteMode,
    freteSel,
    freteSel_col,
    freteManual:parseFloat(document.getElementById('frete-manual').value)||0,
    peso:parseFloat(document.getElementById('peso').value)||0,
    comp:parseFloat(document.getElementById('comp').value)||0,
    larg:parseFloat(document.getElementById('larg').value)||0,
    alt:parseFloat(document.getElementById('alt').value)||0,
    insumos:parseFloat(document.getElementById('insumos').value)||0,
    freteFullTotal:parseFloat(document.getElementById('frete-full').value)||0,
    freteFullQtd:parseInt(document.getElementById('frete-full-qtd').value)||1,
    impostos:parseFloat(document.getElementById('impostos').value)||0,
    comissao:parseFloat(document.getElementById('comissao').value)||0,
    afiliados:parseFloat(document.getElementById('afiliados').value)||0,
    margem:parseFloat(document.getElementById('margem').value)||0,
    quantidade:parseInt(document.getElementById('quantidade').value)||1,
    precoML:parseFloat(document.getElementById('preco-ml').value)||0,
  };

  // Calcula margem no preço ML (se informado)
  let margemML = null;
  if(lastCalc.precoML>0){
    const mlPayout=lastCalc.precoML-lastCalc.base-lastCalc.precoML*lastCalc.pI-lastCalc.precoML*lastCalc.pC-lastCalc.precoML*lastCalc.pA;
    margemML=(mlPayout/lastCalc.precoML)*100;
  }
  const link1=document.getElementById('save-link1')?document.getElementById('save-link1').value.trim():'';
  const link2=document.getElementById('save-link2')?document.getElementById('save-link2').value.trim():'';
  const link3=document.getElementById('save-link3')?document.getElementById('save-link3').value.trim():'';
  const prod={id:Date.now(),nome,forn:document.getElementById('save-forn').value.trim()||'—',cod:document.getElementById('save-cod').value.trim()||'—',obs:document.getElementById('save-obs').value.trim(),link1,link2,link3,custoReal:lastCalc.custo,custoIdeal,precoCalc:lastCalc.preco,precoML:lastCalc.precoML,markup:lastCalc.markup,roi:lastCalc.roi,margem:lastCalc.pM*100,margemML,payout:lastCalc.payout,frete:lastCalc.frete,ins:lastCalc.ins,pI:lastCalc.pI,pC:lastCalc.pC,pA:lastCalc.pA,snapshot};
  // Lê do Firebase para não perder produtos salvos em outros dispositivos
  const prodsAtuais = await fbGet('produtos','realecom_prods','[]');
  prodsAtuais.unshift(prod);
  setCached('realecom_prods',prodsAtuais);
  fbSet('produtos', prodsAtuais);
  registrarAtividade('salvar_produto');
  document.getElementById('save-nome').value='';document.getElementById('save-forn').value='';document.getElementById('save-cod').value='';document.getElementById('save-obs').value='';
  if(document.getElementById('save-link1'))document.getElementById('save-link1').value='';
  if(document.getElementById('save-link2'))document.getElementById('save-link2').value='';
  if(document.getElementById('save-link3'))document.getElementById('save-link3').value='';
  _prodEditId=null;
  const btnUpdate=document.getElementById('btn-atualizar');
  if(btnUpdate)btnUpdate.style.display='none';
  (function(){const el=document.getElementById('btn-salvar-prod');if(el)el.style.display='';})();
  alert('✅ Produto salvo no Dashboard!');
}

async function salvarObs(id,val){
  const prods = await fbGet('produtos','realecom_prods','[]');
  const p=prods.find(p=>p.id===id);
  if(p){p.obs=val;setCached('realecom_prods',prods);fbSet('produtos',prods);}
}
async function deletarProduto(id){
  if(!confirm('Remover este produto?'))return;
  const prods = await fbGet('produtos','realecom_prods','[]');
  const prodsAtualizados = prods.filter(p=>p.id!==id);
  setCached('realecom_prods',prodsAtualizados);
  fbSet('produtos',prodsAtualizados);
  renderDash();
}
function toggleDetail(id){const det=document.getElementById('det-'+id);const btn=document.getElementById('tbtn-'+id);const open=det.style.display==='block';det.style.display=open?'none':'block';btn.textContent=open?'+ detalhes':'− fechar';}

async function renderDash(){
  const el=document.getElementById('dash-content');
  el.innerHTML='<div style="text-align:center;padding:44px;color:var(--text4);font-size:.8rem">Carregando…</div>';
  const prods=await fbGet('produtos','realecom_prods','[]');

  if(!prods.length){
    el.innerHTML='<div style="text-align:center;padding:60px 20px;color:var(--text4)">'
      +'<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" style="opacity:.4;margin-bottom:12px"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/></svg>'
      +'<div style="font-size:.85rem">Nenhum produto salvo ainda.</div>'
      +'<div style="font-size:.74rem;color:var(--text4);margin-top:5px">Faça um cálculo e salve para vê-lo aqui.</div></div>';
    return;
  }

  // margem: valor limpo, cor semântica. Sem pílula — a cor já diz.
  function mg(v){
    if(v===null||v===undefined||isNaN(v)) return '<span style="color:var(--text4);font-weight:500">—</span>';
    const c = v>=15 ? 'var(--in)' : v>=10 ? 'var(--text)' : 'var(--out)';
    return `<span style="color:${c};font-weight:700;font-size:.86rem">${fmtP(v)}</span>`;
  }

  function links(p){
    const ls=[p.link1,p.link2,p.link3].filter(l=>l&&l.trim());
    if(!ls.length) return '<span style="color:var(--text4);font-size:.72rem">—</span>';
    return ls.map((l,i)=>`<a href="${l}" target="_blank" title="${l}" style="display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border:1px solid var(--border);border-radius:5px;font-size:.66rem;color:var(--text3);text-decoration:none;white-space:nowrap;transition:all .15s" onmouseover="this.style.borderColor='var(--text3)';this.style.color='var(--text)'" onmouseout="this.style.borderColor='var(--border)';this.style.color='var(--text3)'"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71"/></svg>${i+1}</a>`).join(' ');
  }

  const ico = {
    calc:'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="6" x2="16" y2="6"/><line x1="8" y1="11" x2="8" y2="11"/><line x1="12" y1="11" x2="12" y2="11"/><line x1="16" y1="11" x2="16" y2="11"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="12" y1="16" x2="12" y2="16"/></svg>',
    del :'<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>',
    star:'<svg width="13" height="13" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.9"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
    chev:'<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><polyline points="6 9 12 15 18 9"/></svg>'
  };
  window.dashToggle = window.dashToggle || function(id, ev){
    if(ev && ev.target.closest('button,a,textarea')) return;   // clique em ação não abre
    const r = document.getElementById('det2-'+id);
    if(!r) return;
    const abrindo = r.style.display !== 'table-row';
    r.style.display = abrindo ? 'table-row' : 'none';
    const c = document.getElementById('cv-'+id);
    if(c) c.style.transform = abrindo ? 'rotate(180deg)' : '';
  };

  const ib = 'background:none;border:1px solid transparent;border-radius:7px;padding:6px;cursor:pointer;display:inline-flex;align-items:center;justify-content:center;transition:all .15s';

  const head=`<table style="width:100%;border-collapse:collapse">
    <thead><tr>
      <th style="padding:0 12px 9px 2px;text-align:left;font-size:.6rem;font-weight:600;text-transform:uppercase;letter-spacing:.09em;color:var(--text4);border-bottom:1px solid var(--border)">Produto</th>
      <th style="padding:0 12px 9px;text-align:right;font-size:.6rem;font-weight:600;text-transform:uppercase;letter-spacing:.09em;color:var(--text4);border-bottom:1px solid var(--border);white-space:nowrap">Margem calc.</th>
      <th style="padding:0 12px 9px;text-align:right;font-size:.6rem;font-weight:600;text-transform:uppercase;letter-spacing:.09em;color:var(--text4);border-bottom:1px solid var(--border);white-space:nowrap">Margem ML</th>
      <th style="padding:0 12px 9px;text-align:left;font-size:.6rem;font-weight:600;text-transform:uppercase;letter-spacing:.09em;color:var(--text4);border-bottom:1px solid var(--border)">Links</th>
      <th style="padding:0 2px 9px;text-align:right;font-size:.6rem;font-weight:600;text-transform:uppercase;letter-spacing:.09em;color:var(--text4);border-bottom:1px solid var(--border)">Ações</th>
    </tr></thead><tbody>`;

  const rows=prods.map(p=>{
    const det='det2-'+p.id;
    const mlCalc = (p.margemML!==undefined&&p.margemML!==null) ? p.margemML
      : (p.precoML>0 ? ((p.precoML-p.custoReal-(p.frete||0)-(p.ins||0)-p.precoML*(p.pI||0)-p.precoML*(p.pC||0)-p.precoML*(p.pA||0))/p.precoML)*100 : null);
    const comp = p.comprado;

    return `<tr onclick="dashToggle(${p.id},event)" style="border-bottom:1px solid var(--border);cursor:pointer" onmouseover="this.style.background='var(--bg2)'" onmouseout="this.style.background='transparent'">
      <td style="padding:11px 12px 11px 2px;vertical-align:middle">
        <div style="display:flex;align-items:center;gap:7px">
          <div style="font-size:.84rem;font-weight:600;color:var(--text);line-height:1.35;transition:color .15s" onmouseover="this.style.color='var(--mark)'" onmouseout="this.style.color='var(--text)'">${p.nome}</div>
          ${comp?'<span style="background:var(--in-bg);color:var(--in);border:1px solid var(--in-line);border-radius:20px;padding:1px 7px;font-size:.58rem;font-weight:600;white-space:nowrap;flex-shrink:0">comprado</span>':''}
        </div>
        <div style="font-size:.68rem;color:var(--text4);margin-top:3px">${p.forn} · ${p.cod}</div>
      </td>
      <td style="padding:11px 12px;text-align:right;vertical-align:middle;white-space:nowrap">${mg(p.margem)}</td>
      <td style="padding:11px 12px;text-align:right;vertical-align:middle;white-space:nowrap">${mg(mlCalc)}</td>
      <td style="padding:11px 12px;vertical-align:middle">${links(p)}</td>
      <td style="padding:11px 2px 11px 12px;vertical-align:middle">
        <div style="display:flex;gap:4px;align-items:center;justify-content:flex-end">
          <button onclick="verNaCalculadora(${p.id})" title="Abrir na calculadora" style="display:inline-flex;align-items:center;gap:5px;background:var(--card);border:1px solid var(--border);border-radius:7px;padding:6px 11px;cursor:pointer;font-size:.7rem;font-weight:600;color:var(--text);white-space:nowrap;font-family:inherit;transition:all .15s" onmouseover="this.style.borderColor='var(--mark)';this.style.background='var(--mark-soft)'" onmouseout="this.style.borderColor='var(--border)';this.style.background='var(--card)'">${ico.calc} Cálculo</button>
          <button onclick="toggleComprado(${p.id})" title="${comp?'Desmarcar compra':'Marcar como comprado'}" style="${ib};color:${comp?'var(--in)':'var(--text3)'};fill:${comp?'var(--in)':'none'};background:${comp?'var(--in-bg)':'none'};border-color:${comp?'var(--in-line)':'transparent'}" onmouseover="this.style.borderColor='var(--in-line)';this.style.color='var(--in)'" onmouseout="this.style.borderColor='${comp?'var(--in-line)':'transparent'}';this.style.color='${comp?'var(--in)':'var(--text3)'}'">${ico.star}</button>
          <button onclick="deletarProduto(${p.id})" title="Remover produto" style="${ib};color:var(--text3)" onmouseover="this.style.color='var(--out)';this.style.borderColor='var(--out)'" onmouseout="this.style.color='var(--text3)';this.style.borderColor='transparent'">${ico.del}</button>
          <button id="cv-${p.id}" onclick="dashToggle(${p.id})" title="Ver detalhes" style="${ib};color:var(--text3);transition:transform .2s,color .15s,border-color .15s" onmouseover="this.style.color='var(--text)';this.style.borderColor='var(--border)'" onmouseout="this.style.color='var(--text3)';this.style.borderColor='transparent'">${ico.chev}</button>
        </div>
      </td>
    </tr>
    <tr id="${det}" style="display:none">
      <td colspan="5" style="padding:4px 2px 18px;border-bottom:1px solid var(--border)">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(112px,1fr));gap:18px;margin-bottom:16px">
          <div><div style="font-size:.6rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--text4);margin-bottom:4px">Preço calc.</div><div style="font-size:.9rem;font-weight:600">${fmt(p.precoCalc)}</div></div>
          <div><div style="font-size:.6rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--text4);margin-bottom:4px">Preço médio ML</div><div style="font-size:.9rem;font-weight:600">${p.precoML>0?fmt(p.precoML):'—'}</div></div>
          <div><div style="font-size:.6rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--text4);margin-bottom:4px">Custo real</div><div style="font-size:.9rem;font-weight:600;color:var(--out)">${fmt(p.custoReal)}</div></div>
          <div><div style="font-size:.6rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--text4);margin-bottom:4px">Custo ideal</div><div style="font-size:.9rem;font-weight:600;color:${p.custoIdeal!==null&&p.custoIdeal>0?'var(--in)':'var(--text4)'}">${p.custoIdeal!==null?fmt(Math.max(p.custoIdeal,0)):'—'}</div></div>
          <div><div style="font-size:.6rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--text4);margin-bottom:4px">Lucro/unid.</div><div style="font-size:.9rem"><span class="mk-dash" data-v="${p.payout}">${fmt(p.payout)}</span></div></div>
        </div>
        <div style="font-size:.6rem;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:var(--text4);margin-bottom:6px">Observações</div>
        <textarea class="prod-obs" onchange="salvarObs(${p.id},this.value)" placeholder="Anotações…">${p.obs||''}</textarea>
      </td>
    </tr>`;
  }).join('');

  el.innerHTML=head+rows+'</tbody></table>';

  const comp=prods.filter(p=>p.comprado).length;
  const comMg=prods.filter(p=>p.margem!==undefined&&p.margem!==null&&!isNaN(p.margem));
  const mgMedia=comMg.length?comMg.reduce(function(s,p){return s+parseFloat(p.margem);},0)/comMg.length:null;
  const st=function(id,v){const e=document.getElementById(id);if(e)e.textContent=v;};
  st('dash-st-total',prods.length);
  st('dash-st-comp',comp);
  st('dash-st-mg',mgMedia!==null?fmtP(mgMedia):'—');

  // marca-texto no lucro por unidade
  const css=getComputedStyle(document.documentElement);
  const bg=css.getPropertyValue('--mark').trim(), fg=css.getPropertyValue('--mark-fg').trim();
  el.querySelectorAll('.mk-dash').forEach(function(s){
    s.style.setProperty('background',bg,'important');
    s.style.setProperty('color',fg,'important');
    s.style.setProperty('-webkit-text-fill-color',fg,'important');
    s.style.cssText+=';padding:2px 8px;border-radius:5px;font-weight:700;display:inline-block';
  });
}

// ============================================================
// SAZONALIDADE
// ============================================================
const DATAS_SAZONAIS = [
  // 2026
  {id:'volta_aulas_jan_26', titulo:'Volta às Aulas — Janeiro', data:'2026-01-15', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#2563eb,#1d4ed8);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z\"/><path d=\"M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z\"/></svg></span>', cor:'#2563eb'},
  {id:'carnaval_26',        titulo:'Carnaval',                 data:'2026-03-01', dias:[30,15],    icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#db2777,#9d174d);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polygon points=\"12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2\"/></svg></span>', cor:'#db2777'},
  {id:'pascoa_26',          titulo:'Páscoa',                   data:'2026-04-05', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#d97706,#b45309);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"5\"/><line x1=\"12\" y1=\"1\" x2=\"12\" y2=\"3\"/><line x1=\"12\" y1=\"21\" x2=\"12\" y2=\"23\"/><line x1=\"4.22\" y1=\"4.22\" x2=\"5.64\" y2=\"5.64\"/><line x1=\"18.36\" y1=\"18.36\" x2=\"19.78\" y2=\"19.78\"/><line x1=\"1\" y1=\"12\" x2=\"3\" y2=\"12\"/><line x1=\"21\" y1=\"12\" x2=\"23\" y2=\"12\"/><line x1=\"4.22\" y1=\"19.78\" x2=\"5.64\" y2=\"18.36\"/><line x1=\"18.36\" y1=\"5.64\" x2=\"19.78\" y2=\"4.22\"/></svg></span>', cor:'#d97706'},
  {id:'maes_26',            titulo:'Dia das Mães',             data:'2026-05-11', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#ec4899,#be185d);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z\"/></svg></span>', cor:'#ec4899'},
  {id:'namorados_26',       titulo:'Dia dos Namorados',        data:'2026-06-12', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#f43f5e,#e11d48);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z\"/></svg></span>', cor:'#f43f5e'},
  {id:'inverno_26',         titulo:'Início do Inverno',        data:'2026-06-21', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#0891b2,#0e7490);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><line x1=\"12\" y1=\"2\" x2=\"12\" y2=\"22\"/><path d=\"M17 7l-5-5-5 5\"/><path d=\"M17 17l-5 5-5-5\"/><line x1=\"2\" y1=\"12\" x2=\"22\" y2=\"12\"/><path d=\"M7 7l-5 5 5 5\"/><path d=\"M17 7l5 5-5 5\"/></svg></span>', cor:'#0891b2'},
  {id:'volta_aulas_jul_26', titulo:'Volta às Aulas — Julho',   data:'2026-07-01', dias:[30,15],    icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#7c3aed,#6d28d9);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 20V10a8 8 0 0 1 16 0v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z\"/><path d=\"M9 20v-5a3 3 0 0 1 6 0v5\"/><line x1=\"8\" y1=\"10\" x2=\"16\" y2=\"10\"/></svg></span>', cor:'#7c3aed'},
  {id:'pais_26',            titulo:'Dia dos Pais',             data:'2026-08-09', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#16a34a,#15803d);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.27-10.44z\"/><path d=\"M10.59 4.59l.6 3.4-3.4-.6z\"/></svg></span>', cor:'#16a34a'},
  {id:'criancas_26',        titulo:'Dia das Crianças',         data:'2026-10-12', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#6B21A8,#9333ea);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polygon points=\"12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2\"/></svg></span>', cor:'#6B21A8'},
  {id:'verao_26',           titulo:'Início do Verão',          data:'2026-09-21', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#F0A070,#ea580c);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"5\"/><line x1=\"12\" y1=\"1\" x2=\"12\" y2=\"3\"/><line x1=\"12\" y1=\"21\" x2=\"12\" y2=\"23\"/><line x1=\"4.22\" y1=\"4.22\" x2=\"5.64\" y2=\"5.64\"/><line x1=\"18.36\" y1=\"18.36\" x2=\"19.78\" y2=\"19.78\"/><line x1=\"1\" y1=\"12\" x2=\"3\" y2=\"12\"/><line x1=\"21\" y1=\"12\" x2=\"23\" y2=\"12\"/><line x1=\"4.22\" y1=\"19.78\" x2=\"5.64\" y2=\"18.36\"/><line x1=\"18.36\" y1=\"5.64\" x2=\"19.78\" y2=\"4.22\"/></svg></span>', cor:'var(--text2)'},
  {id:'blackfriday_26',     titulo:'Black Friday',             data:'2026-11-27', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#4a3f6b,#2d2460);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><line x1=\"12\" y1=\"1\" x2=\"12\" y2=\"23\"/><path d=\"M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6\"/></svg></span>', cor:'#4a3f6b'},
  {id:'natal_26',           titulo:'Natal',                    data:'2026-12-25', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#16a34a,#15803d);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polygon points=\"12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2\"/></svg></span>', cor:'#16a34a'},
  // 2027
  {id:'volta_aulas_jan_27', titulo:'Volta às Aulas — Janeiro', data:'2027-01-15', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#2563eb,#1d4ed8);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z\"/><path d=\"M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z\"/></svg></span>', cor:'#2563eb'},
  {id:'carnaval_27',        titulo:'Carnaval',                 data:'2027-02-14', dias:[30,15],    icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#db2777,#9d174d);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polygon points=\"12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2\"/></svg></span>', cor:'#db2777'},
  {id:'pascoa_27',          titulo:'Páscoa',                   data:'2027-03-28', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#d97706,#b45309);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"5\"/><line x1=\"12\" y1=\"1\" x2=\"12\" y2=\"3\"/><line x1=\"12\" y1=\"21\" x2=\"12\" y2=\"23\"/><line x1=\"4.22\" y1=\"4.22\" x2=\"5.64\" y2=\"5.64\"/><line x1=\"18.36\" y1=\"18.36\" x2=\"19.78\" y2=\"19.78\"/><line x1=\"1\" y1=\"12\" x2=\"3\" y2=\"12\"/><line x1=\"21\" y1=\"12\" x2=\"23\" y2=\"12\"/><line x1=\"4.22\" y1=\"19.78\" x2=\"5.64\" y2=\"18.36\"/><line x1=\"18.36\" y1=\"5.64\" x2=\"19.78\" y2=\"4.22\"/></svg></span>', cor:'#d97706'},
  {id:'maes_27',            titulo:'Dia das Mães',             data:'2027-05-09', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#ec4899,#be185d);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z\"/></svg></span>', cor:'#ec4899'},
  {id:'namorados_27',       titulo:'Dia dos Namorados',        data:'2027-06-12', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#f43f5e,#e11d48);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z\"/></svg></span>', cor:'#f43f5e'},
  {id:'inverno_27',         titulo:'Início do Inverno',        data:'2027-06-21', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#0891b2,#0e7490);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><line x1=\"12\" y1=\"2\" x2=\"12\" y2=\"22\"/><path d=\"M17 7l-5-5-5 5\"/><path d=\"M17 17l-5 5-5-5\"/><line x1=\"2\" y1=\"12\" x2=\"22\" y2=\"12\"/><path d=\"M7 7l-5 5 5 5\"/><path d=\"M17 7l5 5-5 5\"/></svg></span>', cor:'#0891b2'},
  {id:'volta_aulas_jul_27', titulo:'Volta às Aulas — Julho',   data:'2027-07-01', dias:[30,15],    icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#7c3aed,#6d28d9);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 20V10a8 8 0 0 1 16 0v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z\"/><path d=\"M9 20v-5a3 3 0 0 1 6 0v5\"/><line x1=\"8\" y1=\"10\" x2=\"16\" y2=\"10\"/></svg></span>', cor:'#7c3aed'},
  {id:'pais_27',            titulo:'Dia dos Pais',             data:'2027-08-08', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#16a34a,#15803d);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.27-10.44z\"/><path d=\"M10.59 4.59l.6 3.4-3.4-.6z\"/></svg></span>', cor:'#16a34a'},
  {id:'criancas_27',        titulo:'Dia das Crianças',         data:'2027-10-12', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#6B21A8,#9333ea);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polygon points=\"12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2\"/></svg></span>', cor:'#6B21A8'},
  {id:'verao_27',           titulo:'Início do Verão',          data:'2027-09-21', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#F0A070,#ea580c);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"5\"/><line x1=\"12\" y1=\"1\" x2=\"12\" y2=\"3\"/><line x1=\"12\" y1=\"21\" x2=\"12\" y2=\"23\"/><line x1=\"4.22\" y1=\"4.22\" x2=\"5.64\" y2=\"5.64\"/><line x1=\"18.36\" y1=\"18.36\" x2=\"19.78\" y2=\"19.78\"/><line x1=\"1\" y1=\"12\" x2=\"3\" y2=\"12\"/><line x1=\"21\" y1=\"12\" x2=\"23\" y2=\"12\"/><line x1=\"4.22\" y1=\"19.78\" x2=\"5.64\" y2=\"18.36\"/><line x1=\"18.36\" y1=\"5.64\" x2=\"19.78\" y2=\"4.22\"/></svg></span>', cor:'var(--text2)'},
  {id:'blackfriday_27',     titulo:'Black Friday',             data:'2027-11-26', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#4a3f6b,#2d2460);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><line x1=\"12\" y1=\"1\" x2=\"12\" y2=\"23\"/><path d=\"M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6\"/></svg></span>', cor:'#4a3f6b'},
  {id:'natal_27',           titulo:'Natal',                    data:'2027-12-25', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#16a34a,#15803d);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polygon points=\"12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2\"/></svg></span>', cor:'#16a34a'},
];

function verificarSazonalidade(){
  renderSazonalGrid();
  showPage('sazonal', true);
}

function toggleSazonal(id){
  const selecionados = getCached('realecom_sazonal_sel','[]');
  const idx = selecionados.indexOf(id);
  if(idx>=0) selecionados.splice(idx,1);
  else selecionados.push(id);
  setCached('realecom_sazonal_sel', selecionados);
  renderSazonalGrid();
}

function renderSazonalGrid(){
  const el = document.getElementById('sazonal-grid');
  if(!el) return;
  const selecionados = getCached('realecom_sazonal_sel','[]');
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const titulosVistos = new Set();
  const datasFuturas = DATAS_SAZONAIS
    .filter(d => new Date(d.data + 'T00:00:00') >= hoje)
    .filter(d => {
      if(titulosVistos.has(d.titulo)) return false;
      titulosVistos.add(d.titulo);
      return true;
    })
    .sort((a,b) => a.data.localeCompare(b.data));

  el.innerHTML = datasFuturas.map(d => {
    const dataEv = new Date(d.data + 'T00:00:00');
    const sel = selecionados.includes(d.id);
    const diasRestantes = Math.round((dataEv - hoje) / (1000*60*60*24));
    const dataFmt = d.data.split('-').reverse().join('/');
    return '<div onclick="toggleSazonal(\'' + d.id + '\')" data-id="' + d.id + '" style="background:var(--card);border:2px solid ' + (sel?d.cor+'88':'var(--border)') + ';border-radius:12px;padding:12px 14px;cursor:pointer;user-select:none;transition:all .2s;' + (sel?'background:'+d.cor+'12':'') + '">' +
      '<div style="display:flex;align-items:center;gap:8px">' +
        '<span style="pointer-events:none;display:flex">' + d.icon + '</span>' +
        '<div style="flex:1;pointer-events:none">' +
          '<div style="font-size:.82rem;font-weight:700;color:var(--text)">' + d.titulo + '</div>' +
          '<div style="font-size:.68rem;color:var(--text3)">' + dataFmt + ' · em ' + diasRestantes + ' dias</div>' +
        '</div>' +
        '<div style="width:20px;height:20px;border-radius:50%;border:2px solid ' + (sel?d.cor:'var(--border)') + ';background:' + (sel?d.cor:'none') + ';display:flex;align-items:center;justify-content:center;flex-shrink:0;pointer-events:none;transition:all .2s">' +
          (sel?'<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>':'') +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');

  const count = document.getElementById('sazonal-count');
  if(count) count.textContent = selecionados.filter(id=>datasFuturas.some(d=>d.id===id)).length + ' selecionadas';
}
function selecionarTodasSazonais(sel){
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const titulosVistos = new Set();
  const datasFuturas = DATAS_SAZONAIS.filter(d=>{
    const dataEv = new Date(d.data+'T00:00:00');
    if(dataEv < hoje) return false;
    if(titulosVistos.has(d.titulo)) return false;
    titulosVistos.add(d.titulo);
    return true;
  }).map(d=>d.id);
  setCached('realecom_sazonal_sel', sel?datasFuturas:[]);
  renderSazonalGrid();
}

function salvarSazonalidade(){
  const selecionados = getCached('realecom_sazonal_sel','[]');
  if(!selecionados.length){
    if(!confirm('Nenhuma data selecionada. Deseja salvar assim mesmo?')) return;
  }

  const hoje = new Date(); hoje.setHours(0,0,0,0);

  // Remove lembretes sazonais futuros existentes antes de recriar
  let evs = getEventos().filter(e=>{
    if(e.tipo!=='sazonal') return true;
    const dataEv = new Date(e.data+'T00:00:00');
    return dataEv < hoje; // mantém passados
  });

  let criados = 0;

  selecionados.forEach(id => {
    const d = DATAS_SAZONAIS.find(x=>x.id===id);
    if(!d) return;
    const dataEv = new Date(d.data + 'T00:00:00');
    if(dataEv < hoje) return;

    // Evento principal no dia
    evs.push({
      id: Date.now()+Math.random(),
      titulo: d.titulo,
      tipo: 'sazonal',
      data: d.data,
      hora: '',
      obs: 'Data sazonal — planejamento de estoque',
      push: true,
      sazonalId: d.id
    });
    criados++;

    // Lembretes de antecedência
    d.dias.forEach((diasAntes, i) => {
      const dataLembrete = new Date(dataEv.getTime() - diasAntes*24*60*60*1000);
      if(dataLembrete < hoje) return;
      const dataStr = dataLembrete.toISOString().split('T')[0];
      evs.push({
        id: Date.now()+Math.random()+i,
        titulo: `${d.titulo} em ${dia
