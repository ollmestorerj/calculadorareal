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
async function fbSet(colecao, dados){
  try{
    const uid = await getUserId();
    if(!uid) return;
    const db=await getDB();
    await db.collection('usuarios').doc(uid)
      .collection(colecao).doc('data')
      .set({payload: JSON.stringify(dados), ts: Date.now()});
  }catch(e){ console.warn('Firebase write error:', e); }
}

// Lê array do Firebase, fallback para localStorage
async function fbGet(colecao, localKey, fallback){
  try{
    const uid = await getUserId();
    if(!uid) return JSON.parse(localStorage.getItem(localKey)||fallback);
    const db=await getDB();
    const doc=await db.collection('usuarios').doc(uid)
      .collection(colecao).doc('data').get();
    if(doc.exists){
      const dados=JSON.parse(doc.data().payload);
      // Atualiza cache local com dados deste usuário
      localStorage.setItem(localKey, JSON.stringify(dados));
      return dados;
    }
    // Sem dado no Firebase — limpa cache local e retorna vazio
    // NUNCA subir dados do localStorage para evitar vazamento entre usuários
    localStorage.removeItem(localKey);
    return JSON.parse(fallback);
  }catch(e){
    console.warn('Firebase read error:', e);
    // Só usa cache local se o usuário atual está logado
    const uid = firebase.auth().currentUser ? firebase.auth().currentUser.email : null;
    if(uid) return JSON.parse(localStorage.getItem(localKey)||fallback);
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
    await db.collection('usuarios').doc(uid).set({
      nome: s?s.nome:'',
      email: uid,
      ultimaAtividade: Date.now(),
      ultimaAcao: acao
    },{merge:true});
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
  const expira=Date.now()+(SESSAO_DURACAO_H*60*60*1000);
  localStorage.setItem('realecom_sessao',JSON.stringify({...dados,expira}));
}

async function sair(){
  if(!confirm('Deseja sair da sua conta?'))return;
  const sb=document.getElementById('sidebar');
  if(sb)sb.style.display='none';
  try{const auth=await getAuth();await auth.signOut();}catch(e){}
  // Limpa TODOS os dados do usuário do localStorage ao sair
  // Evita vazamento para quem logar depois neste mesmo PC
  ['realecom_sessao','realecom_prods','realecom_eventos','realecom_metas','realecom_sazonal_sel'].forEach(k=>localStorage.removeItem(k));
  // Reseta cache de auth para não usar userId do usuário anterior
  _cachedUserId = null;
  _authResolved = false;
  _jaEntrou = false;
  _fazendoLogout = false;
  location.reload();
}

async function fazerLogin(){
  const email=document.getElementById('login-email').value.trim().toLowerCase();
  const senha=document.getElementById('login-senha').value;
  if(!email||!senha){mostrarErroLogin('Preencha o e-mail e a senha.');return;}

  const btn=document.getElementById('btn-login');
  const loading=document.getElementById('login-loading');
  btn.disabled=true;
  document.getElementById('login-erro').style.display='none';
  document.getElementById('login-validade').style.display='none';
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
    setTimeout(()=>entrarNoApp({nome:dados.nome||email,validade:dados.validade||'—',email}),900);

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
    el.style.color='#4ade80';
    el.textContent='📧 E-mail de recuperação enviado! Verifique sua caixa de entrada.';
    document.getElementById('login-erro').style.display='none';
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
    localStorage.setItem('realecom_prods',JSON.stringify(prods));

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
    const metaObj=JSON.parse(localStorage.getItem('realecom_metas')||'{}');
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
    localStorage.setItem('realecom_eventos',JSON.stringify(evs));
    // Calendário home — eventos de hoje e próximos
    const hoje=new Date();hoje.setHours(0,0,0,0);
    const hojeStr=hoje.toISOString().split('T')[0];
    const cores={full:'#a78bfa',conta:'#f87171',entrega:'#4ade80',outro:'#F0A070'};
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
            <div style="width:3px;height:26px;background:${cores[e.tipo]||'#F0A070'};border-radius:2px;flex-shrink:0"></div>
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
    localStorage.setItem('realecom_metas',JSON.stringify(m));
  });
  registrarAtividade('login');
  inicializarPush();
  setTimeout(()=>{
    showPage(pagina||'home', true);
    setTimeout(()=>verificarConfirmacoesSazonais(), 800);
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
        localStorage.setItem('realecom_telefone', dados.telefone);
      } else {
        localStorage.removeItem('realecom_telefone');
      }
      const ultimaPagina = localStorage.getItem('realecom_pagina')||'home';
      entrarNoApp({
        email: user.email,
        nome: dados.nome || user.email,
        validade: dados.validade || '—',
        plano: dados.plano || ''
      }, ultimaPagina);

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
        _fazendoLogout = true;
        _jaEntrou = false;
        await firebase.auth().signOut();
        ['realecom_sessao','realecom_prods','realecom_eventos','realecom_metas','realecom_sazonal_sel'].forEach(k=>localStorage.removeItem(k));
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
const pesoFaixas=[[0,.3],[.3,.5],[.5,1],[1,1.5],[1.5,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,11],[11,13],[13,15],[15,17],[17,20],[20,25],[25,30],[30,40],[40,50],[50,60],[60,70],[70,80],[80,90],[90,100],[100,125],[125,150],[150,1e9]];
const pesoLabels=['Até 0,3kg','0,3–0,5kg','0,5–1kg','1–1,5kg','1,5–2kg','2–3kg','3–4kg','4–5kg','5–6kg','6–7kg','7–8kg','8–9kg','9–11kg','11–13kg','13–15kg','15–17kg','17–20kg','20–25kg','25–30kg','30–40kg','40–50kg','50–60kg','60–70kg','70–80kg','80–90kg','90–100kg','100–125kg','125–150kg','+150kg'];
const precoFaixas=[0,19,49,79,100,120,150,200];
const precoLabels=['R$0–18','R$19–48','R$49–78','R$79–99','R$100–119','R$120–149','R$150–199','R$200+'];
const T=[[5.65,6.55,7.75,12.35,14.35,16.45,18.45,20.95],[5.95,6.65,7.85,13.25,15.45,17.65,19.85,22.55],[6.05,6.75,7.95,13.85,16.15,18.45,20.75,23.65],[6.15,6.85,8.05,14.15,16.45,18.85,21.15,24.65],[6.25,6.95,8.15,14.45,16.85,19.25,21.65,24.65],[6.35,7.95,8.55,15.75,18.35,21.05,23.65,26.25],[6.45,8.15,8.95,17.05,19.85,22.65,25.55,28.35],[6.55,8.35,9.75,18.45,21.55,24.65,27.75,30.75],[6.65,8.55,9.95,25.45,28.55,32.65,35.75,39.75],[6.75,8.75,10.15,27.05,31.05,36.05,40.05,44.05],[6.85,8.95,10.35,28.85,33.65,38.45,43.25,48.05],[6.95,9.15,10.55,29.65,34.55,39.55,44.45,49.35],[7.05,9.55,10.95,41.25,48.05,54.95,61.75,68.65],[7.15,9.95,11.35,42.15,49.25,56.25,63.25,70.25],[7.25,10.15,11.55,45.05,52.45,59.95,67.45,74.95],[7.35,10.35,11.75,48.55,56.05,63.55,70.75,78.65],[7.45,10.55,11.95,54.75,63.85,72.95,82.05,91.15],[7.65,10.95,12.15,64.05,75.05,84.75,95.35,105.95],[7.75,11.15,12.35,65.95,75.45,85.55,96.25,106.95],[7.85,11.35,12.55,67.75,78.95,88.95,99.15,107.05],[7.95,11.55,12.75,70.25,81.05,92.05,102.55,110.75],[8.05,11.75,12.95,74.95,86.45,98.15,109.35,118.15],[8.15,11.95,13.15,80.25,92.95,105.05,117.15,126.55],[8.25,12.15,13.35,83.95,97.05,109.85,122.45,132.25],[8.35,12.35,13.55,93.25,107.45,122.05,136.05,146.95],[8.45,12.55,13.75,106.55,123.95,139.55,155.55,167.95],[8.55,12.75,13.95,119.25,138.05,156.05,173.95,187.95],[8.65,12.75,14.15,126.55,146.15,165.65,184.65,199.45],[8.75,12.75,14.35,166.15,192.45,217.55,242.55,261.95]];

let pesoUsado=0,freteSel=0,freteSel_col=undefined,freteMode='manual',lastCalc=null,calcMode=1;
let calAno=new Date().getFullYear(),calMes=new Date().getMonth(),evEditId=null;

function fmt(v){return'R$ '+v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});}
function fmtKg(v){return v%1===0?v.toFixed(0)+' kg':v.toFixed(v<1?3:2)+' kg';}
function fmtP(v){return v.toFixed(2).replace('.',',')+' %';}

function showPage(p,bypassCheck){
  // Proteção: bloqueia acesso às páginas internas sem sessão
  if(p!=='login'&&!bypassCheck&&!verificarSessao()){location.reload();return;}
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  document.getElementById('page-'+p).classList.add('active');

  // Destaca item ativo na sidebar
  document.querySelectorAll('.sb-item').forEach(b=>b.classList.remove('active'));
  const mapa={calc:'sb-calc',dash:'sb-dash',metas:'sb-metas',cal:'sb-cal',gestao:'sb-gestao',simples:'sb-simples',pub:'sb-pub',ncm:'sb-ncm',home:'sb-home'};
  if(mapa[p]){const el=document.getElementById(mapa[p]);if(el)el.classList.add('active');}

  if(p==='dash')renderDash();
  if(p==='cal'){renderCal();carregarTelefoneWhatsApp();}
  if(p==='metas')carregarMetas();
  if(p==='gestao')calcularGestao();
  if(p==='simples'){document.getElementById('sn-resultado').style.display='none';document.getElementById('sn-empty').style.display='block';}
  if(p==='pub'){switchPubMode('dash');renderHistoricoPublicidade();}
  if(p==='sazonal'){renderSazonalGrid();}
  if(p==='ncm'){renderHistoricoNCM();}
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
    aviso.style.cssText='display:block;margin-top:6px;background:#05291622;border:1px solid #16a34a55;border-radius:9px;padding:8px 11px;font-size:.76rem;color:#4ade80;line-height:1.5';
    aviso.textContent=`✅ Faixa correta! O preço calculado (${fmt(lastCalc.preco)}) está dentro da faixa ${precoLabels[colCorreta]}.`;
  }else{
    aviso.style.cssText='display:block;margin-top:6px;background:#7f1d1d22;border:1px solid #ef444455;border-radius:9px;padding:8px 11px;font-size:.76rem;color:#f87171;line-height:1.5';
    aviso.textContent=`⚠️ Atenção: o preço calculado (${fmt(lastCalc.preco)}) corresponde à faixa ${precoLabels[getPrecoIdx(lastCalc.preco)]}, mas você selecionou ${precoLabels[freteSel_col]}.`;
  }
}

function selFrete(col,val){freteSel=val;freteSel_col=col;renderTable(col);document.getElementById('frete-badge').style.display='block';document.getElementById('frete-val').textContent=fmt(val);verificarFaixaFrete();}

function calcPeso(){
  const pr=parseFloat(document.getElementById('peso').value)||0;
  const c=parseFloat(document.getElementById('comp').value)||0,l=parseFloat(document.getElementById('larg').value)||0,a=parseFloat(document.getElementById('alt').value)||0;
  const pv=(c*l*a)/6000;pesoUsado=Math.max(pr,pv);freteSel=0;freteSel_col=undefined;
  document.getElementById('frete-badge').style.display='none';
  const pi=document.getElementById('peso-info'),fs=document.getElementById('frete-section');
  if(pr>0||pv>0){
    pi.style.display='flex';
    document.getElementById('pi-real').textContent=pr>0?fmtKg(pr):'—';
    document.getElementById('pi-vol').textContent=pv>0?fmtKg(pv):'—';
    document.getElementById('pi-usado').textContent=fmtKg(pesoUsado)+(pv>pr&&pv>0?' (vol.)':' (real)');
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
    for(let c=0;c<precoLabels.length;c++){
      const sel=isA&&c===selCol,v=T[r][c].toFixed(2).replace('.',',');
      h+=isA?`<td class="fopt${sel?' fsel':''}" onclick="selFrete(${c},${T[r][c]})">R$${v}</td>`:`<td>R$${v}</td>`;
    }
    h+='</tr>';
  });
  tbl.innerHTML=h+'</tbody>';
}

function switchFrete(mode){freteMode=mode;document.getElementById('tab-dim').style.display=mode==='dim'?'block':'none';document.getElementById('tab-manual').style.display=mode==='manual'?'block':'none';document.getElementById('btn-dim').className='toggle-btn'+(mode==='dim'?' active':'');document.getElementById('btn-manual').className='toggle-btn'+(mode==='manual'?' active':'');}

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
    mlLabel.innerHTML='💛 Preço Médio ML (R$) <span style="color:#f87171;font-size:.65rem">(obrigatório)</span>';
    document.getElementById('mode-desc').innerHTML='<strong style="color:var(--text3)">Modo Por Margem:</strong> Defina sua margem e descubra o preço mínimo ideal.';
    document.getElementById('price-grid').style.gridTemplateColumns='1fr 1fr';
    document.getElementById('pc-ml-card').style.display='block';
  }else{
    b2.style.background='linear-gradient(135deg,#6B21A8,#F0A070)';b2.style.color='#fff';
    b1.style.background='none';b1.style.color='#4a3f6b';
    mb.style.display='none';mlInput.placeholder='Obrigatório';
    mlLabel.innerHTML='💛 Preço Médio ML (R$) <span style="color:#f87171">*</span>';
    document.getElementById('mode-desc').innerHTML='<strong style="color:var(--text3)">Modo Pelo Mercado:</strong> Informe o preço médio ML e descubra sua margem real.';
  }
}

function calcular(){
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
    document.getElementById('price-grid').style.gridTemplateColumns='1fr';
    document.getElementById('pc-ml-card').style.display='none';
    document.querySelector('.price-card.calc .pc-tag').textContent='🌐 Preço Médio do Mercado';
    document.getElementById('pc-preco').textContent=fmt(precoML);
    document.getElementById('pc-mk').textContent=markup.toFixed(2).replace('.',',');
    document.getElementById('pc-roi').textContent=fmtP(roi);
    document.getElementById('pc-mg').textContent=fmtP(margemReal);
    const badge=document.querySelector('.price-card.calc .pc-badge');
    badge.textContent=margemReal>=10?'✅ Margem saudável':margemReal>=0?'⚠️ Margem baixa':'❌ Prejuízo';
    badge.style.cssText=`display:inline-block;padding:3px 10px;border-radius:20px;font-size:.67rem;font-weight:700;margin-bottom:9px;background:${margemReal>=10?'rgba(74,222,128,.2)':margemReal>=0?'rgba(240,160,112,.2)':'rgba(239,68,68,.2)'};color:${margemReal>=10?'#4ade80':margemReal>=0?'#F0A070':'#f87171'}`;
    const fator15=1-0.15-pI-pC-pA;
    const custoMax15=fator15>0?(precoML*fator15-frete-ins):null;
    document.getElementById('explain-text').innerHTML=`Vendendo a <strong style="color:var(--o)">${fmt(precoML)}</strong>, sua margem real seria <strong style="color:${margemReal>=10?'#4ade80':margemReal>=0?'#F0A070':'#f87171'}">${fmtP(margemReal)}</strong>. ${margemReal<0?'Você está vendendo com <strong style="color:#f87171">prejuízo</strong>.':margemReal<10?'Margem abaixo de 10% — avalie se vale a pena.':'Margem dentro de um bom patamar.'}<br><br>💡 Para ter 15% de margem vendendo a ${fmt(precoML)}, compre por no máximo <strong style="color:${custoMax15!==null&&custoMax15>0?'#4ade80':'#f87171'}">${custoMax15!==null&&custoMax15>0?fmt(custoMax15):'Inviável com os custos atuais'}</strong>.`;
    if(pesoUsado>0&&freteMode==='dim'){renderTable(getPrecoIdx(precoML));verificarFaixaFrete();}
    preencherDetalhes(custo,frete,ins,base,vI,vC,vA,0,precoML,payout,qtd,inv,vI*qtd);
    document.getElementById('bottom-wrapper').style.display='flex';
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

  document.getElementById('price-grid').style.gridTemplateColumns='1fr 1fr';
  document.querySelector('.price-card.calc .pc-tag').textContent='🎯 Preço Ideal Calculado';
  const mainBadge=document.querySelector('.price-card.calc .pc-badge');
  mainBadge.textContent='✅ Preço mínimo seguro';
  mainBadge.style.cssText='display:inline-block;padding:3px 10px;border-radius:20px;background:rgba(74,222,128,.2);color:#4ade80;font-size:.67rem;font-weight:700;margin-bottom:9px';
  document.getElementById('pc-preco').textContent=fmt(preco);
  document.getElementById('pc-mk').textContent=markup.toFixed(2).replace('.',',');
  document.getElementById('pc-roi').textContent=fmtP(roi);
  document.getElementById('pc-mg').textContent=fmtP(pM*100);

  const mlCard=document.getElementById('pc-ml-card');mlCard.style.display='block';
  if(precoML>0){
    const mlvI=precoML*pI,mlvC=precoML*pC,mlvA=precoML*pA;
    const mlPayout=precoML-base-mlvI-mlvC-mlvA;
    const mlMarkup=custo>0?precoML/custo:0,mlRoi=inv>0?(mlPayout*qtd/inv)*100:0,mlMargem=(mlPayout/precoML)*100;
    document.getElementById('pc-ml-preco').textContent=fmt(precoML);
    document.getElementById('ml-mk').textContent=mlMarkup.toFixed(2).replace('.',',');
    document.getElementById('ml-roi').textContent=fmtP(mlRoi);
    document.getElementById('ml-mg').textContent=fmtP(mlMargem);
    document.getElementById('pc-ml-kpis').style.opacity='1';
    const diff=precoML-preco,pct=Math.abs((diff/preco)*100).toFixed(1);
    if(Math.abs(diff)<0.01){
      mlCard.className='price-card ml-equal';
      document.getElementById('pc-ml-badge').style.cssText='display:inline-block;padding:3px 10px;border-radius:20px;background:rgba(139,92,246,.25);color:#c4b5fd;font-size:.67rem;font-weight:700;margin-bottom:9px';
      document.getElementById('pc-ml-badge').textContent='= Igual ao preço calculado';
      document.getElementById('pc-ml-tag').textContent='💛 Preço Médio ML';
      document.getElementById('explain-text').innerHTML=`Preço médio ML igual ao seu preço mínimo. Você pode vender nesse valor mantendo a margem definida.`;
    }else if(diff>0){
      mlCard.className='price-card ml-cheaper';
      document.getElementById('pc-ml-badge').style.cssText='display:inline-block;padding:3px 10px;border-radius:20px;background:rgba(74,222,128,.2);color:#4ade80;font-size:.67rem;font-weight:700;margin-bottom:9px';
      document.getElementById('pc-ml-badge').textContent=`✅ ${pct}% acima do seu mínimo`;
      document.getElementById('pc-ml-tag').textContent='💛 Preço Médio ML';
      document.getElementById('explain-text').innerHTML=`O mercado paga <strong style="color:#4ade80">${pct}% a mais</strong> que seu preço mínimo. Você pode ser mais competitivo ou vender no preço médio e aumentar a margem.`;
    }else{
      mlCard.className='price-card ml-pricier';
      document.getElementById('pc-ml-badge').style.cssText='display:inline-block;padding:3px 10px;border-radius:20px;background:rgba(239,68,68,.2);color:#f87171;font-size:.67rem;font-weight:700;margin-bottom:9px';
      document.getElementById('pc-ml-badge').textContent=`⚠️ ${pct}% abaixo do seu mínimo`;
      document.getElementById('pc-ml-tag').textContent='⚠️ Preço Médio ML';
      const custoIdeal=precoML*fator-frete-ins;
      document.getElementById('explain-text').innerHTML=`Preço médio ML está <strong style="color:#f87171">${pct}% abaixo</strong> do seu mínimo. Para vender a ${fmt(precoML)} com a mesma margem, compre por no máximo <strong style="color:#4ade80">${fmt(Math.max(custoIdeal,0))}</strong>.`;
    }
    document.getElementById('bottom-wrapper').style.display='flex';
  }else{
    mlCard.className='price-card ml-none';
    document.getElementById('pc-ml-preco').textContent='—';
    document.getElementById('pc-ml-badge').style.cssText='display:inline-block;padding:3px 10px;border-radius:20px;background:rgba(255,255,255,.08);color:var(--text2);font-size:.67rem;font-weight:700;margin-bottom:9px';
    document.getElementById('pc-ml-badge').textContent='Informe o preço médio';
    document.getElementById('pc-ml-kpis').style.opacity='.25';
    ['ml-mk','ml-roi','ml-mg'].forEach(id=>document.getElementById(id).textContent='—');
    document.getElementById('explain-text').innerHTML=`Este é o menor preço que cobre todos os seus custos com a margem definida. Informe o <strong style="color:var(--o)">Preço Médio ML</strong> para ver o comparativo.`;
    document.getElementById('bottom-wrapper').style.display='none';
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
    if(alerta){alertBox.style.display='block';document.getElementById('frete-alert-content').innerHTML=`<div class="brow"><span class="bl">Frete atual</span><span class="br" style="color:#f87171">${fmt(frete)}</span></div><div class="brow"><span class="bl">Frete vendendo até ${fmt(alerta.limitePreco)}</span><span class="br" style="color:#4ade80">${fmt(alerta.freteNovo)}</span></div><div class="brow total"><span class="bl">Economia</span><span class="br" style="color:#4ade80">${fmt(alerta.ganhoFrete)}</span></div><div style="margin-top:8px;font-size:.78rem;color:var(--text2)">Vendendo por até <strong style="color:var(--o)">${fmt(alerta.limitePreco)}</strong> seu frete cai <strong style="color:#4ade80">${fmt(alerta.ganhoFrete)}</strong>.</div>`;}
    else{alertBox.style.display='none';}
  }else{alertBox.style.display='none';}

  preencherDetalhes(custo,frete,ins,base,vI,vC,vA,vM,preco,payout,qtd,inv,vI*qtd);
  finalizarCalculo();
}

function preencherDetalhes(custo,frete,ins,base,vI,vC,vA,vM,preco,payout,qtd,inv,totalImp){
  document.getElementById('bd-custo').textContent=fmt(custo);
  document.getElementById('bd-frete').textContent=fmt(frete);
  const freteFullUnit=lastCalc&&lastCalc.freteFullUnit||0;
  const insSemFull=ins-freteFullUnit;
  const elBdFull=document.getElementById('bd-frete-full');
  const elBdFullRow=document.getElementById('bd-frete-full-row');
  if(elBdFull&&elBdFullRow){
    if(freteFullUnit>0){elBdFull.textContent=fmt(freteFullUnit);elBdFullRow.style.display='flex';}
    else{elBdFullRow.style.display='none';}
  }
  document.getElementById('bd-outros').textContent=fmt(insSemFull>0?insSemFull:ins);
  document.getElementById('bd-base').textContent=fmt(base);
  document.getElementById('bd-imp').textContent=fmt(vI);
  document.getElementById('bd-com').textContent=fmt(vC);
  document.getElementById('bd-afi').textContent=fmt(vA);
  document.getElementById('bd-mar').textContent=fmt(vM);
  document.getElementById('bd-preco').textContent=fmt(preco);

  // Projeção — Preço Calculado
  document.getElementById('proj-qtd').textContent=qtd;
  document.getElementById('proj-cu').textContent=fmt(custo);
  document.getElementById('proj-inv').textContent=fmt(inv);
  document.getElementById('proj-imp').textContent=fmt(totalImp);
  document.getElementById('proj-fat').textContent=fmt(preco*qtd);
  document.getElementById('proj-pay').textContent=fmt(payout);
  document.getElementById('proj-lb').textContent=fmt(payout*qtd);
  document.getElementById('proj-cx-bruto').textContent=fmt(inv+payout*qtd+totalImp);
  document.getElementById('proj-cx').textContent=fmt(inv+payout*qtd);

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
    // Coluna A — Preço Margem
    s('pd-cu-a').textContent=fmt(custo);
    s('pd-inv-a').textContent=fmt(inv);
    s('pd-imp-a').textContent=fmt(totalImp);
    s('pd-fat-a').textContent=fmt(preco*qtd);
    s('pd-pay-a').textContent=fmt(payout);
    s('pd-cx-bruto-a').textContent=fmt(inv+payout*qtd+totalImp);
    s('pd-cx-a').textContent=fmt(inv+payout*qtd);
    s('pd-lb-a').textContent=fmt(payout*qtd);
    // Coluna B — Preço Médio
    s('pd-cu-b').textContent=fmt(custo);
    s('pd-inv-b').textContent=fmt(inv);
    s('pd-imp-b').textContent=fmt(mlImp);
    s('pd-fat-b').textContent=fmt(precoML*qtd);
    const elPayB=s('pd-pay-b');
    elPayB.textContent=fmt(mlPayout);
    elPayB.style.color=mlPayout>=0?'var(--text2)':'#f87171';
    s('pd-cx-bruto-b').textContent=fmt(inv+mlPayout*qtd+mlImp);
    s('pd-cx-b').textContent=fmt(inv+mlPayout*qtd);
    const elLbB=s('pd-lb-b');
    elLbB.textContent=fmt(mlPayout*qtd);
    elLbB.style.color=mlPayout*qtd>=0?'var(--text2)':'#f87171';
  }else{
    if(header)header.style.display='none';
    if(simple)simple.style.display='block';
    if(double)double.style.display='none';
  }
}

function finalizarCalculo(){
  document.getElementById('right-empty').style.display='none';
  document.getElementById('right-result').style.display='block';
  
  // Mostrar caixa de devolução
  if(lastCalc&&lastCalc.payout>0){
    calcDevolucao();
  }
}

function resetar(){
  // Reseta modo edição — CRÍTICO: sem isso, salvar após "Novo Cálculo" atualiza o produto anterior
  _prodEditId = null;
  const btnAtualizar = document.getElementById('btn-atualizar');
  const btnSalvar = document.getElementById('btn-salvar-prod');
  if(btnAtualizar) btnAtualizar.style.display = 'none';
  if(btnSalvar) btnSalvar.style.display = '';
  // Limpa campos do save-card
  ['save-nome','save-forn','save-cod','save-obs','save-link1','save-link2','save-link3']
    .forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  // Fecha seção de links
  const linksDiv = document.getElementById('links-anuncio');
  if(linksDiv) linksDiv.style.display = 'none';

  // Limpa painel direito
  document.getElementById('right-empty').style.display='flex';
  document.getElementById('right-result').style.display='none';
  document.getElementById('bottom-wrapper').style.display='none';

  // Custo dos produtos — reseta para 1 item vazio
  const list=document.getElementById('items-list');
  list.innerHTML='<div class="item-row"><input type="number" class="item-input" placeholder="Custo item 1 (R$)" min="0" step="0.01"><button class="remove-btn" onclick="removeItem(this)">×</button></div>';

  // Frete por dimensões
  ['peso','comp','larg','alt'].forEach(id=>{document.getElementById(id).value='';});
  document.getElementById('peso-info').style.display='none';
  document.getElementById('frete-section').style.display='none';
  document.getElementById('frete-badge').style.display='none';
  document.getElementById('frete-aviso').style.display='none';

  // Frete manual
  document.getElementById('frete-manual').value='';

  // Insumos e Full
  document.getElementById('insumos').value='';
  document.getElementById('frete-full').value='';
  document.getElementById('frete-full-qtd').value='';
  document.getElementById('frete-full-result').style.display='none';
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
  document.getElementById('rank-resultado').style.display='none';

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
  localStorage.setItem('realecom_prods',JSON.stringify(prods));
  fbSet('produtos',prods);
  _prodEditId=null;
  document.getElementById('btn-atualizar').style.display='none';
  document.getElementById('btn-salvar-prod').style.display='';
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
  localStorage.setItem('realecom_prods',JSON.stringify(prodsAtuais));
  fbSet('produtos', prodsAtuais);
  registrarAtividade('salvar_produto');
  document.getElementById('save-nome').value='';document.getElementById('save-forn').value='';document.getElementById('save-cod').value='';document.getElementById('save-obs').value='';
  if(document.getElementById('save-link1'))document.getElementById('save-link1').value='';
  if(document.getElementById('save-link2'))document.getElementById('save-link2').value='';
  if(document.getElementById('save-link3'))document.getElementById('save-link3').value='';
  _prodEditId=null;
  const btnUpdate=document.getElementById('btn-atualizar');
  if(btnUpdate)btnUpdate.style.display='none';
  document.getElementById('btn-salvar-prod').style.display='';
  alert('✅ Produto salvo no Dashboard!');
}

async function salvarObs(id,val){
  const prods = await fbGet('produtos','realecom_prods','[]');
  const p=prods.find(p=>p.id===id);
  if(p){p.obs=val;localStorage.setItem('realecom_prods',JSON.stringify(prods));fbSet('produtos',prods);}
}
async function deletarProduto(id){
  if(!confirm('Remover este produto?'))return;
  const prods = await fbGet('produtos','realecom_prods','[]');
  const prodsAtualizados = prods.filter(p=>p.id!==id);
  localStorage.setItem('realecom_prods',JSON.stringify(prodsAtualizados));
  fbSet('produtos',prodsAtualizados);
  renderDash();
}
function toggleDetail(id){const det=document.getElementById('det-'+id);const btn=document.getElementById('tbtn-'+id);const open=det.style.display==='block';det.style.display=open?'none':'block';btn.textContent=open?'+ detalhes':'− fechar';}

async function renderDash(){
  const el=document.getElementById('dash-content');
  el.innerHTML='<div style="text-align:center;padding:40px;opacity:.4;font-size:.8rem;color:#888">Carregando...</div>';
  const prods=await fbGet('produtos','realecom_prods','[]');
  if(!prods.length){el.innerHTML='<div style="text-align:center;padding:60px 20px;opacity:.25;color:#888"><p style="font-size:2rem">📦</p><br><p style="font-size:.85rem">Nenhum produto salvo ainda.</p></div>';return;}

  function mgBadge(v){
    if(v===null||v===undefined||isNaN(v))return'<span style="font-size:.72rem;color:var(--text3)">—</span>';
    const cor=v>=15?'background:#16a34a22;color:#4ade80':v>=10?'background:#F0A07022;color:#F0A070':'background:#dc262622;color:#f87171';
    return`<span style="${cor};padding:2px 9px;border-radius:20px;font-size:.72rem;font-weight:700">${fmtP(v)}</span>`;
  }

  function linkChips(p){
    const links=[p.link1,p.link2,p.link3].filter(l=>l&&l.trim());
    if(!links.length)return'<span style="font-size:.7rem;color:var(--text3)">—</span>';
    return links.map((l,i)=>`<a href="${l}" target="_blank" style="display:inline-block;padding:2px 8px;border:1px solid var(--border);border-radius:6px;font-size:.68rem;color:var(--o);text-decoration:none;white-space:nowrap" title="${l}">🔗 Anúncio ${i+1}</a>`).join(' ');
  }

  const svgDel=`<svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>`;

  const header=`<table style="width:100%;border-collapse:collapse;font-size:.78rem">
    <thead>
      <tr style="border-bottom:1.5px solid var(--border)">
        <th style="padding:8px 10px;text-align:left;font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);width:32%">Produto</th>
        <th style="padding:8px 10px;text-align:center;font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);width:13%">Margem calc.</th>
        <th style="padding:8px 10px;text-align:center;font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);width:13%">Margem ML</th>
        <th style="padding:8px 10px;text-align:center;font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);width:20%">Links</th>
        <th style="padding:8px 10px;text-align:center;font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text3);width:22%">Ações</th>
      </tr>
    </thead><tbody>`;

  const rows=prods.map((p,idx)=>{
    const zebra=idx%2===0?'background:var(--card)':'background:var(--bg2)';
    const compBadge=p.comprado?'<span style="background:#16a34a22;color:#4ade80;border-radius:20px;padding:1px 7px;font-size:.6rem;font-weight:700;margin-left:5px">✅</span>':'';
    const detId='det2-'+p.id;
    return`<tr style="${zebra};border-bottom:1px solid var(--border)">
      <td style="padding:8px 10px;vertical-align:middle">
        <div style="font-size:.82rem;font-weight:700;color:var(--text)">${p.nome}${compBadge}</div>
        <div style="font-size:.68rem;color:var(--text3);margin-top:2px">🏭 ${p.forn} · ${p.cod}</div>
      </td>
      <td style="padding:8px 10px;text-align:center;vertical-align:middle">${mgBadge(p.margem)}</td>
      <td style="padding:8px 10px;text-align:center;vertical-align:middle">${mgBadge(p.margemML!==undefined&&p.margemML!==null?p.margemML:(p.precoML>0?((p.precoML-p.custoReal-(p.frete||0)-(p.ins||0)-p.precoML*(p.pI||0)-p.precoML*(p.pC||0)-p.precoML*(p.pA||0))/p.precoML)*100:null))}</td>
      <td style="padding:8px 10px;text-align:center;vertical-align:middle">${linkChips(p)}</td>
      <td style="padding:8px 10px;vertical-align:middle">
        <div style="display:flex;gap:4px;align-items:center;flex-wrap:nowrap">
          <button onclick="verNaCalculadora(${p.id})" style="background:none;border:1px solid var(--border);border-radius:7px;padding:4px 8px;cursor:pointer;font-size:.68rem;font-weight:700;color:var(--o);white-space:nowrap;flex-shrink:0">🧮 Cálculo</button>
          <button onclick="var r=document.getElementById('${detId}');var open=r.style.display==='table-row';r.style.display=open?'none':'table-row';this.textContent=open?'+ detalhes':'− fechar'" style="background:none;border:1px solid var(--border);border-radius:7px;padding:4px 8px;cursor:pointer;font-size:.68rem;color:var(--text2);white-space:nowrap;flex-shrink:0">+ detalhes</button>
          <button onclick="toggleComprado(${p.id})" title="${p.comprado?'Desmarcar':'Marcar como comprado'}" style="background:${p.comprado?'#16a34a22':'none'};border:1px solid ${p.comprado?'#16a34a44':'var(--border)'};border-radius:7px;padding:4px 7px;cursor:pointer;font-size:.68rem;font-weight:700;color:${p.comprado?'#4ade80':'var(--text2)'};flex-shrink:0">${p.comprado?'★':'☆'}</button>
          <button onclick="deletarProduto(${p.id})" style="background:none;border:1px solid var(--border);border-radius:7px;padding:4px 6px;cursor:pointer;flex-shrink:0;display:flex;align-items:center;justify-content:center" class="btn-del">${svgDel}</button>
        </div>
      </td>
    </tr>
    <tr id="${detId}" style="display:none;background:var(--bg2)">
      <td colspan="5" style="padding:14px 16px;border-bottom:1px solid var(--border)">
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:8px;margin-bottom:10px">
          <div class="pd-item"><div class="pdl">Preço calc.</div><div class="pdv">${fmt(p.precoCalc)}</div></div>
          <div class="pd-item"><div class="pdl">Preço médio ML</div><div class="pdv">${p.precoML>0?fmt(p.precoML):'—'}</div></div>
          <div class="pd-item"><div class="pdl">Custo real</div><div class="pdv">${fmt(p.custoReal)}</div></div>
          <div class="pd-item"><div class="pdl">Custo ideal</div><div class="pdv" style="color:${p.custoIdeal!==null&&p.custoIdeal>0?'#4ade80':'var(--text3)'}">${p.custoIdeal!==null?fmt(Math.max(p.custoIdeal,0)):'—'}</div></div>
          <div class="pd-item"><div class="pdl">Lucro/unid.</div><div class="pdv">${fmt(p.payout)}</div></div>
        </div>
        <div style="font-size:.62rem;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:5px">📝 Observações</div>
        <textarea class="prod-obs" onchange="salvarObs(${p.id},this.value)" placeholder="Anotações...">${p.obs||''}</textarea>
      </td>
    </tr>`;
  }).join('');

  el.innerHTML=header+rows+'</tbody></table>';
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
  {id:'verao_26',           titulo:'Início do Verão',          data:'2026-09-21', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#F0A070,#ea580c);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"5\"/><line x1=\"12\" y1=\"1\" x2=\"12\" y2=\"3\"/><line x1=\"12\" y1=\"21\" x2=\"12\" y2=\"23\"/><line x1=\"4.22\" y1=\"4.22\" x2=\"5.64\" y2=\"5.64\"/><line x1=\"18.36\" y1=\"18.36\" x2=\"19.78\" y2=\"19.78\"/><line x1=\"1\" y1=\"12\" x2=\"3\" y2=\"12\"/><line x1=\"21\" y1=\"12\" x2=\"23\" y2=\"12\"/><line x1=\"4.22\" y1=\"19.78\" x2=\"5.64\" y2=\"18.36\"/><line x1=\"18.36\" y1=\"5.64\" x2=\"19.78\" y2=\"4.22\"/></svg></span>', cor:'#F0A070'},
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
  {id:'verao_27',           titulo:'Início do Verão',          data:'2027-09-21', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#F0A070,#ea580c);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"5\"/><line x1=\"12\" y1=\"1\" x2=\"12\" y2=\"3\"/><line x1=\"12\" y1=\"21\" x2=\"12\" y2=\"23\"/><line x1=\"4.22\" y1=\"4.22\" x2=\"5.64\" y2=\"5.64\"/><line x1=\"18.36\" y1=\"18.36\" x2=\"19.78\" y2=\"19.78\"/><line x1=\"1\" y1=\"12\" x2=\"3\" y2=\"12\"/><line x1=\"21\" y1=\"12\" x2=\"23\" y2=\"12\"/><line x1=\"4.22\" y1=\"19.78\" x2=\"5.64\" y2=\"18.36\"/><line x1=\"18.36\" y1=\"5.64\" x2=\"19.78\" y2=\"4.22\"/></svg></span>', cor:'#F0A070'},
  {id:'blackfriday_27',     titulo:'Black Friday',             data:'2027-11-26', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#4a3f6b,#2d2460);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><line x1=\"12\" y1=\"1\" x2=\"12\" y2=\"23\"/><path d=\"M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6\"/></svg></span>', cor:'#4a3f6b'},
  {id:'natal_27',           titulo:'Natal',                    data:'2027-12-25', dias:[45,30,15], icon:'<span style=\"width:32px;height:32px;background:linear-gradient(135deg,#16a34a,#15803d);border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0\"><svg width=\"14\" height=\"14\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"white\" stroke-width=\"2.2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><polygon points=\"12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2\"/></svg></span>', cor:'#16a34a'},
];

function verificarSazonalidade(){
  renderSazonalGrid();
  showPage('sazonal', true);
}

function toggleSazonal(id){
  const selecionados = JSON.parse(localStorage.getItem('realecom_sazonal_sel')||'[]');
  const idx = selecionados.indexOf(id);
  if(idx>=0) selecionados.splice(idx,1);
  else selecionados.push(id);
  localStorage.setItem('realecom_sazonal_sel', JSON.stringify(selecionados));
  renderSazonalGrid();
}

function renderSazonalGrid(){
  const el = document.getElementById('sazonal-grid');
  if(!el) return;
  const selecionados = JSON.parse(localStorage.getItem('realecom_sazonal_sel')||'[]');
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
  localStorage.setItem('realecom_sazonal_sel', JSON.stringify(sel?datasFuturas:[]));
  renderSazonalGrid();
}

function salvarSazonalidade(){
  const selecionados = JSON.parse(localStorage.getItem('realecom_sazonal_sel')||'[]');
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
        titulo: `${d.titulo} em ${diasAntes} dias`,
        tipo: 'sazonal',
        data: dataStr,
        hora: '09:00',
        obs: `Faltam ${diasAntes} dias para ${d.titulo}. Você vai participar desta data?`,
        push: true,
        sazonalId: d.id,
        lembrete: true,
        diasAntes
      });
      criados++;
    });
  });

  saveEventos(evs);

  if(Notification.permission==='granted') agendarTodasNotificacoes();

  alert(`✅ ${criados} lembretes criados no calendário!`);
  showPage('cal');
}

// Verificar se há notificação de confirmação de sazonalidade pendente
function verificarConfirmacoesSazonais(){
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const notificados = JSON.parse(sessionStorage.getItem('sazonal_notif')||'[]');

  getEventos().filter(e=>e.tipo==='sazonal'&&e.lembrete).forEach(ev=>{
    const dataEv = new Date(ev.data+'T00:00:00');
    const diff = Math.round((dataEv-hoje)/(1000*60*60*24));
    if(diff!==0) return;
    if(notificados.includes(ev.id)) return;

    // Mostra notificação in-app perguntando se vai participar
    setTimeout(()=>{
      mostrarNotifSazonal(ev);
      notificados.push(ev.id);
      sessionStorage.setItem('sazonal_notif', JSON.stringify(notificados));
    }, 2000);
  });
}

function mostrarNotifSazonal(ev){
  const d = DATAS_SAZONAIS.find(x=>x.id===ev.sazonalId);
  const container = document.getElementById('notif-container');
  const div = document.createElement('div');
  div.className='notif outro';
  div.style.borderColor='#F0A070';
  div.style.maxWidth='340px';
  div.innerHTML=`
    <div class="notif-body" style="width:100%">
      <div class="notif-title" style="color:#F0A070;margin-bottom:4px">${ev.titulo.replace(/ em \d+ dias/,'')}</div>
      <div class="notif-sub" style="margin-bottom:10px">${ev.obs}</div>
      <div style="display:flex;gap:8px">
        <button onclick="confirmarSazonal('sim','${ev.sazonalId}',this)" style="flex:1;padding:6px;background:#16a34a22;border:1px solid #16a34a55;color:#4ade80;border-radius:7px;font-size:.72rem;font-weight:700;cursor:pointer">✅ Sim, vou participar</button>
        <button onclick="confirmarSazonal('nao','${ev.sazonalId}',this)" style="flex:1;padding:6px;background:#7f1d1d22;border:1px solid #ef444455;color:#f87171;border-radius:7px;font-size:.72rem;font-weight:700;cursor:pointer">❌ Não vou participar</button>
      </div>
    </div>
    <button class="notif-close" onclick="this.parentElement.remove()">×</button>`;
  container.appendChild(div);
}

function confirmarSazonal(resp, sazonalId, btn){
  const notif = btn.closest('.notif');
  if(resp==='nao'){
    // Remove todos os lembretes futuros desta sazonalidade
    const hoje = new Date(); hoje.setHours(0,0,0,0);
    const evs = getEventos().filter(e=>{
      if(e.sazonalId!==sazonalId) return true;
      const dataEv = new Date(e.data+'T00:00:00');
      return dataEv <= hoje; // mantém passados, remove futuros
    });
    saveEventos(evs);
    // Remove da lista de selecionados
    const sel = JSON.parse(localStorage.getItem('realecom_sazonal_sel')||'[]').filter(x=>x!==sazonalId);
    localStorage.setItem('realecom_sazonal_sel', JSON.stringify(sel));
    if(notif) notif.remove();
    mostrarNotifMsg({tipo:'outro',data:''}, '✅ Lembretes removidos para esta data.', 1);
  } else {
    if(notif) notif.remove();
    mostrarNotifMsg({tipo:'outro',data:''}, '🚀 Ótimo! Verifique seu calendário para se preparar.', 1);
  }
}

// ============================================================
// ============================================================
let _swRegistration = null;

async function inicializarPush(){
  if(!('serviceWorker' in navigator)||!('Notification' in window)) return;
  try{
    _swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
    atualizarBtnPush();
  }catch(e){ console.warn('SW registro falhou:', e); }
}

function atualizarBtnPush(){
  const btn = document.getElementById('btn-push-cal');
  const lbl = document.getElementById('btn-push-label');
  if(!btn||!lbl) return;
  if(Notification.permission === 'granted'){
    lbl.textContent = '🔔 Notificações ativas';
    btn.style.borderColor = '#16a34a44';
    btn.style.color = '#4ade80';
  } else if(Notification.permission === 'denied'){
    lbl.textContent = '🔕 Notificações bloqueadas';
    btn.style.color = '#f87171';
  } else {
    lbl.textContent = 'Ativar notificações';
  }
}

async function solicitarPermissaoNotificacao(){
  if(!('Notification' in window)){alert('Seu navegador não suporta notificações.');return;}
  if(Notification.permission === 'granted'){alert('Notificações já estão ativas!');return;}
  if(Notification.permission === 'denied'){alert('Notificações estão bloqueadas. Vá em Configurações do navegador → Privacidade → Notificações e permita este site.');return;}
  const perm = await Notification.requestPermission();
  atualizarBtnPush();
  if(perm === 'granted'){
    new Notification('RealEcom', {body:'Notificações ativadas! Você receberá lembretes dos seus eventos.', icon:'/logcon.png'});
    // Agenda notificações dos eventos existentes
    agendarTodasNotificacoes();
  }
}

function agendarNotificacao(titulo, corpo, dataHora, tag){
  if(Notification.permission !== 'granted') return;
  const agora = Date.now();
  const quando = dataHora instanceof Date ? dataHora.getTime() : dataHora;
  const delay = quando - agora;
  if(delay <= 0) return; // já passou
  if(delay > 7 * 24 * 60 * 60 * 1000) return; // mais de 7 dias, não agenda (limite do SW)
  setTimeout(()=>{
    if(Notification.permission === 'granted'){
      new Notification('RealEcom — ' + titulo, {body: corpo, icon:'/logcon.png', tag});
    }
  }, delay);
}

function agendarNotificacoesEvento(ev){
  if(Notification.permission !== 'granted') return;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const dataEv = new Date(ev.data + 'T00:00:00');
  const diffDias = Math.round((dataEv - hoje) / (1000*60*60*24));

  // Regras por tipo
  let diasAntes = [];
  if(ev.tipo === 'full'){
    diasAntes = [5,4,3,2,1];
  } else if(ev.titulo === 'Pagamento DAS'){
    diasAntes = [1];
  } else if(ev.tipo === 'giro_pedido' || ev.tipo === 'giro_entrega'){
    diasAntes = [3,2,1];
  } else {
    diasAntes = [1];
  }

  // Agenda notificações de antecedência
  diasAntes.forEach(d => {
    if(diffDias === d){
      const msg = d === 1 ? `Amanhã: ${ev.titulo}` : `Em ${d} dias: ${ev.titulo}`;
      agendarNotificacao(ev.titulo, msg, new Date(hoje.getTime() + 9*60*60*1000), `${ev.id}_${d}d`);
    }
  });

  // No dia — manhã (9h) e tarde (15h)
  if(diffDias === 0){
    agendarNotificacao(ev.titulo, `Hoje: ${ev.titulo}${ev.obs?' — '+ev.obs:''}`, new Date(hoje.getTime() + 9*60*60*1000), `${ev.id}_manha`);
    agendarNotificacao(ev.titulo, `Lembrete tarde: ${ev.titulo}`, new Date(hoje.getTime() + 15*60*60*1000), `${ev.id}_tarde`);
  }
}

function agendarTodasNotificacoes(){
  getEventos().forEach(ev => agendarNotificacoesEvento(ev));
}

// ============================================================
// CALENDÁRIO — TEMPLATES
// ============================================================
const templatesEvento = {
  das:        {titulo:'Pagamento DAS', tipo:'conta', obs:'Vencimento mensal do DAS - Simples Nacional'},
  full:       {titulo:'Coleta Full', tipo:'full', obs:''},
  cartao:     {titulo:'Pagar Cartão', tipo:'conta', obs:''},
  estoque:    {titulo:'Ver Estoque', tipo:'outro', obs:'Conferir nível de estoque'},
  fornecedor: {titulo:'Pedido ao Fornecedor', tipo:'entrega', obs:''},
};

function abrirModalTemplate(tipo){
  const t = templatesEvento[tipo];
  if(!t) return;
  // Usa a data já preenchida no modal (dia clicado) ou hoje como fallback
  const dataAtual = document.getElementById('ev-data').value || new Date().toISOString().split('T')[0];
  abrirModal(dataAtual);
  setTimeout(()=>{
    document.getElementById('ev-titulo').value = t.titulo;
    document.getElementById('ev-tipo').value = t.tipo;
    document.getElementById('ev-obs').value = t.obs;
    document.getElementById('ev-push').checked = true;
  }, 50);
}

// Também expor como aplicarTemplate para compatibilidade com modal
function aplicarTemplate(tipo){ abrirModalTemplate(tipo); }

// ============================================================
// CALENDÁRIO
// ============================================================
const tipoInfo={full:{icon:'📦',label:'Coleta Full',cls:'full'},conta:{icon:'💰',label:'Vencimento de Conta',cls:'conta'},entrega:{icon:'🚚',label:'Entrega',cls:'entrega'},outro:{icon:'📌',label:'Outro',cls:'outro'},sazonal:{icon:'📅',label:'Data Sazonal',cls:'sazonal'},giro_pedido:{icon:'🛒',label:'Pedido Giro',cls:'outro'},giro_entrega:{icon:'📦',label:'Entrega Giro',cls:'entrega'}};
const diasSemana=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const meses=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
function getEventos(){return JSON.parse(localStorage.getItem('realecom_eventos')||'[]');}
function saveEventos(evs){localStorage.setItem('realecom_eventos',JSON.stringify(evs));fbSet('eventos',evs);}
function navMes(dir){calMes+=dir;if(calMes>11){calMes=0;calAno++;}if(calMes<0){calMes=11;calAno--;}renderCal();}

// Cores por tipo para pills — dark mode
const tipoCores={
  full:        {bg:'#7c3aed18',color:'#a78bfa',dot:'#7c3aed'},
  conta:       {bg:'#dc262618',color:'#f87171',dot:'#dc2626'},
  entrega:     {bg:'#16a34a18',color:'#4ade80',dot:'#16a34a'},
  outro:       {bg:'#F0A07018',color:'#F0A070',dot:'#F0A070'},
  sazonal:     {bg:'#d9770618',color:'#fbbf24',dot:'#d97706'},
  giro_pedido: {bg:'#7c3aed18',color:'#a78bfa',dot:'#7c3aed'},
  giro_entrega:{bg:'#16a34a18',color:'#4ade80',dot:'#16a34a'},
};

// Cores por tipo para pills — light mode
const tipoCoresLight={
  full:        {bg:'#ede9fe',color:'#5b21b6',dot:'#7c3aed'},
  conta:       {bg:'#fee2e2',color:'#b91c1c',dot:'#dc2626'},
  entrega:     {bg:'#dcfce7',color:'#15803d',dot:'#16a34a'},
  outro:       {bg:'#fff7ed',color:'#c2410c',dot:'#ea580c'},
  sazonal:     {bg:'#fef3c7',color:'#92400e',dot:'#d97706'},
  giro_pedido: {bg:'#ede9fe',color:'#5b21b6',dot:'#7c3aed'},
  giro_entrega:{bg:'#dcfce7',color:'#15803d',dot:'#16a34a'},
};

function getTipoCores(tipo){
  const isLight = document.body.classList.contains('light');
  const mapa = isLight ? tipoCoresLight : tipoCores;
  return mapa[tipo] || (isLight ? {bg:'#f3f4f6',color:'#374151',dot:'#6b7280'} : tipoCores.outro);
}

function nomesCurto(titulo){
  const mapa={
    'Pagamento DAS':'DAS','Coleta Full':'Coleta Full','Pagar Cartão':'Cartão',
    'Ver Estoque':'Estoque','Pedido ao Fornecedor':'Fornecedor',
    'Fazer pedido ao fornecedor':'Pedido','Chegada do novo lote':'Lote',
    'Volta às Aulas — Janeiro':'Volta Aulas','Volta às Aulas — Julho':'Volta Aulas',
    'Carnaval':'Carnaval','Páscoa':'Páscoa','Dia das Mães':'Dia das Mães',
    'Dia dos Namorados':'Namorados','Início do Inverno':'Inverno',
    'Dia dos Pais':'Dia dos Pais','Início do Verão':'Verão',
    'Dia das Crianças':'Crianças','Black Friday':'Black Friday','Natal':'Natal',
  };
  if(mapa[titulo]) return mapa[titulo];
  const base=titulo.replace(/ em \d+ dias?$/,'');
  if(mapa[base]) return mapa[base];
  return titulo.length>12?titulo.substring(0,11)+'…':titulo;
}

function renderCal(){
  document.getElementById('cal-titulo').textContent=`${meses[calMes]} ${calAno}`;
  const grid=document.getElementById('cal-grid');
  const eventos=getEventos();
  const hoje=new Date();
  const primeiroDia=new Date(calAno,calMes,1).getDay();
  const diasNoMes=new Date(calAno,calMes+1,0).getDate();
  let h='';
  diasSemana.forEach(d=>h+=`<div class="cal-day-header">${d}</div>`);
  for(let i=0;i<primeiroDia;i++){
    const d=new Date(calAno,calMes,0).getDate()-primeiroDia+i+1;
    h+=`<div class="cal-day other-month" style="height:82px"><div class="day-num">${d}</div></div>`;
  }
  for(let d=1;d<=diasNoMes;d++){
    const dataStr=`${calAno}-${String(calMes+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isHoje=hoje.getFullYear()===calAno&&hoje.getMonth()===calMes&&hoje.getDate()===d;
    const evsDia=eventos.filter(e=>e.data===dataStr);
    const max=3;
    let pillsHtml=evsDia.slice(0,max).map(e=>{
      const tipo=e.tipo||(e.titulo==='Pagamento DAS'?'conta':'outro');
      const c=getTipoCores(tipo);
      const nome=nomesCurto(e.titulo);
      return `<div onclick="event.stopPropagation();abrirModal('${dataStr}',${e.id})" title="${e.titulo}" style="display:flex;align-items:center;gap:3px;background:${c.bg};border-radius:4px;padding:2px 5px;margin-top:2px;cursor:pointer;overflow:hidden"><span style="width:5px;height:5px;border-radius:50%;background:${c.dot};flex-shrink:0"></span><span style="font-size:.6rem;color:${c.color};font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${nome}</span></div>`;
    }).join('');
    if(evsDia.length>max) pillsHtml+=`<div style="font-size:.58rem;color:var(--text3);padding-left:3px;margin-top:1px">+${evsDia.length-max}</div>`;
    h+=`<div class="cal-day${isHoje?' today':''}" onclick="abrirModal('${dataStr}')" style="height:82px;overflow:hidden"><div class="day-num">${d}</div>${pillsHtml}</div>`;
  }
  const total=primeiroDia+diasNoMes;
  const resto=total%7===0?0:7-(total%7);
  for(let i=1;i<=resto;i++) h+=`<div class="cal-day other-month" style="height:82px"><div class="day-num">${i}</div></div>`;
  grid.innerHTML=h;
}

function abrirModal(data,evId){
  evEditId=evId||null;
  const ev=evId?getEventos().find(e=>e.id===evId):null;
  document.getElementById('ev-data').value=ev?ev.data:(data||'');
  document.getElementById('ev-titulo').value=ev?ev.titulo:'';
  document.getElementById('ev-hora').value=ev?ev.hora:'';
  document.getElementById('ev-obs').value=ev?ev.obs:'';
  document.getElementById('ev-local').value=ev?(ev.local||''):'';
  document.getElementById('ev-tipo').value=ev?ev.tipo:'full';
  document.getElementById('ev-push').checked=ev?!!ev.push:true;
  document.getElementById('modal-title').textContent=ev?'✏️ Editar Evento':(data?`📅 Novo Evento — ${data.split('-').reverse().join('/')}`:'📅 Novo Evento');
  let btnDel=document.getElementById('btn-del-ev');
  if(!btnDel){
    btnDel=document.createElement('button');btnDel.id='btn-del-ev';btnDel.className='btn-cancel';
    btnDel.style.cssText='background:#ff3b3018;border-color:#ff3b3055;color:#f87171;margin-right:auto';
    btnDel.textContent='🗑 Excluir';btnDel.onclick=()=>excluirEvento();
    document.querySelector('.modal-btns').prepend(btnDel);
  }
  btnDel.style.display=ev?'block':'none';
  document.getElementById('modal-overlay').classList.add('open');
  setTimeout(()=>document.getElementById('ev-titulo').focus(),100);
}

function salvarEvento(){
  const titulo=document.getElementById('ev-titulo').value.trim();
  if(!titulo){alert('Informe o título do evento.');return;}
  const evs=getEventos();
  const novoEv={
    titulo,
    tipo:document.getElementById('ev-tipo').value,
    data:document.getElementById('ev-data').value,
    hora:document.getElementById('ev-hora').value,
    obs:document.getElementById('ev-obs').value.trim(),
    local:document.getElementById('ev-local').value.trim(),
    push:document.getElementById('ev-push').checked
  };
  if(evEditId){
    const idx=evs.findIndex(e=>e.id===evEditId);
    if(idx>=0)evs[idx]={...evs[idx],...novoEv};
  }else{
    novoEv.id=Date.now();
    evs.push(novoEv);
  }
  saveEventos(evs);
  // Agenda notificação push se ativado
  if(novoEv.push){
    if(Notification.permission==='granted'){
      agendarNotificacoesEvento(novoEv.id?novoEv:{...novoEv,id:evs[evs.length-1].id});
    }else if(Notification.permission!=='denied'){
      solicitarPermissaoNotificacao();
    }
  }
  fecharModal();renderCal();
}

function fecharModal(){document.getElementById('modal-overlay').classList.remove('open');evEditId=null;}

function excluirEvento(){
  if(!evEditId)return;
  if(!confirm('Excluir este evento?'))return;
  saveEventos(getEventos().filter(e=>e.id!==evEditId));
  fecharModal();renderCal();
}

document.getElementById('modal-overlay').addEventListener('click',e=>{if(e.target===document.getElementById('modal-overlay'))fecharModal();});

// NOTIFICAÇÕES
const msgFull={5:'📦 Coleta Full em 5 dias! Vai enviar? Se não for presta atenção na data limite de cancelamento!',4:'📦 Coleta Full em 4 dias! Se for alterar a data presta atenção para não tomar multa!',3:'📦 Coleta Full em 3 dias! Já conferiu todos os produtos do envio? Olha lá!',2:'📦 Coleta Full em 2 dias! Etiquetou tudo? Não esquece de cobrir o cód. de barras eim!',1:'📦 Coleta Full amanhã!',0:'📦 Hoje é o dia da Coleta Full! Não esquece a Autorização de Entrada e a Nota de Remessa!'};

function mostrarNotifMsg(ev,mensagem,diffDias){
  const container=document.getElementById('notif-container');
  const ti=tipoInfo[ev.tipo];
  const urgencia=diffDias===0?'#f87171':diffDias===1?'#F0A070':'#a78bfa';
  const div=document.createElement('div');div.className=`notif ${ev.tipo}`;div.style.borderColor=urgencia;
  div.innerHTML=`<div class="notif-icon">${ti.icon}</div><div class="notif-body"><div class="notif-title" style="color:${urgencia}">${mensagem}</div><div class="notif-sub">${ev.data.split('-').reverse().join('/')}${ev.hora?' às '+ev.hora:''}${ev.obs?' — '+ev.obs:''}</div></div><button class="notif-close" onclick="this.parentElement.remove()">×</button>`;
  container.appendChild(div);
  setTimeout(()=>{if(div.parentElement)div.remove();},8000);
}

function garantirDAS(){
  // Garante que existe evento DAS no dia 20 de cada mês (próximos 12 meses)
  const evs=getEventos();
  const hoje=new Date();
  let alterado=false;

  for(let i=0;i<12;i++){
    const d=new Date(hoje.getFullYear(),hoje.getMonth()+i,20);
    const dataStr=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-20`;
    const jaExiste=evs.some(e=>e.data===dataStr&&e.titulo==='Pagamento DAS');
    if(!jaExiste){
      evs.push({id:Date.now()+i,titulo:'Pagamento DAS',tipo:'conta',data:dataStr,hora:'',obs:'Vencimento mensal do DAS - Simples Nacional'});
      alterado=true;
    }
  }
  if(alterado)saveEventos(evs);
}

function verificarNotificacoes(){
  garantirDAS();
  const hoje=new Date();hoje.setHours(0,0,0,0);
  const notificados=JSON.parse(sessionStorage.getItem('notificados')||'[]');
  getEventos().forEach(ev=>{
    const dataEv=new Date(ev.data+'T00:00:00');
    const diffDias=Math.round((dataEv-hoje)/(1000*60*60*24));
    const chave=`${ev.id}_${diffDias}`;
    if(notificados.includes(chave))return;
    // DAS: notifica nos 5 dias anteriores e no dia
    if(ev.titulo==='Pagamento DAS'&&diffDias>=0&&diffDias<=5){
      const msgs={0:'💰 Hoje é o vencimento do DAS! Não esqueça de pagar.',1:'💰 DAS vence amanhã! Já separou o valor?',2:'💰 DAS vence em 2 dias.',3:'💰 DAS vence em 3 dias.',4:'💰 DAS vence em 4 dias.',5:'💰 DAS vence em 5 dias.'};
      setTimeout(()=>mostrarNotifMsg(ev,msgs[diffDias],diffDias),800);
      notificados.push(chave);
    } else if(ev.tipo==='full'&&diffDias>=0&&diffDias<=5){
      setTimeout(()=>mostrarNotifMsg(ev,msgFull[diffDias],diffDias),800);notificados.push(chave);
    } else if(ev.tipo!=='full'&&ev.titulo!=='Pagamento DAS'&&(diffDias===0||diffDias===1)){
      const ti=tipoInfo[ev.tipo];const msg=diffDias===0?`${ti.icon} Hoje: ${ev.titulo}!`:`${ti.icon} Amanhã: ${ev.titulo}!`;
      setTimeout(()=>mostrarNotifMsg(ev,msg,diffDias),800);notificados.push(chave);
    }
  });
  sessionStorage.setItem('notificados',JSON.stringify(notificados));
}

// Permite scroll mesmo com input numérico em foco — só bloqueia scroll dentro do input
document.addEventListener('wheel',e=>{
  if(document.activeElement&&document.activeElement.type==='number'){
    document.activeElement.blur();
  }
},{passive:true});
verificarNotificacoes();

function exportarExcel(){
  const prods=JSON.parse(localStorage.getItem('realecom_prods')||'[]');
  if(!prods.length){alert('Nenhum produto no Dashboard para exportar.');return;}

  const fmt2=(v)=>typeof v==='number'?v.toFixed(2).replace('.',','):v||'';

  // Cabeçalho
  const rows=[
    ['Nome','Fornecedor','Código','Custo Real (R$)','Custo Ideal (R$)','Preço Calculado (R$)','Preço Médio ML (R$)','Lucro/unid. (R$)','Markup','ROI (%)','Margem (%)','Observações']
  ];

  prods.forEach(p=>{
    rows.push([
      p.nome||'',
      p.forn||'',
      p.cod||'',
      fmt2(p.custoReal),
      p.custoIdeal!==null?fmt2(Math.max(p.custoIdeal,0)):'',
      fmt2(p.precoCalc),
      p.precoML>0?fmt2(p.precoML):'',
      fmt2(p.payout),
      p.markup?p.markup.toFixed(2).replace('.',','):'',
      fmt2(p.roi),
      fmt2(p.margem),
      p.obs||''
    ]);
  });

  // Gerar CSV com separador ; (compatível com Excel BR)
  const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(';')).join('\r\n');
  const bom='\uFEFF'; // BOM para Excel reconhecer UTF-8
  const blob=new Blob([bom+csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=`dashboard_realecom_${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============================================================
// DASHBOARD — toggleComprado
// ============================================================
async function toggleComprado(id){
  const prods = await fbGet('produtos','realecom_prods','[]');
  const p=prods.find(p=>p.id===id);
  if(p){p.comprado=!p.comprado;localStorage.setItem('realecom_prods',JSON.stringify(prods));fbSet('produtos',prods);renderDash();}
}

// ============================================================
// VER NA CALCULADORA — restaura o cálculo salvo
// ============================================================
function verNaCalculadora(id){
  const prods=JSON.parse(localStorage.getItem('realecom_prods')||'[]');
  const p=prods.find(p=>p.id===id);
  if(!p){alert('Produto não encontrado.');return;}

  // Ativa modo edição
  _prodEditId=id;

  const s=p.snapshot;

  // Navega para a calculadora primeiro
  showPage('calc', true);

  // Preenche campos do save-card com dados do produto
  setTimeout(()=>{
    if(document.getElementById('save-nome'))document.getElementById('save-nome').value=p.nome||'';
    if(document.getElementById('save-forn'))document.getElementById('save-forn').value=p.forn||'';
    if(document.getElementById('save-cod'))document.getElementById('save-cod').value=p.cod||'';
    if(document.getElementById('save-obs'))document.getElementById('save-obs').value=p.obs||'';
    if(document.getElementById('save-link1'))document.getElementById('save-link1').value=p.link1||'';
    if(document.getElementById('save-link2'))document.getElementById('save-link2').value=p.link2||'';
    if(document.getElementById('save-link3'))document.getElementById('save-link3').value=p.link3||'';
    // Abre seção de links se houver algum preenchido
    if((p.link1||p.link2||p.link3)&&document.getElementById('links-anuncio')){
      document.getElementById('links-anuncio').style.display='flex';
    }
    // Mostra botão atualizar e esconde salvar
    const btnAtualizar=document.getElementById('btn-atualizar');
    const btnSalvar=document.getElementById('btn-salvar-prod');
    if(btnAtualizar)btnAtualizar.style.display='';
    if(btnSalvar)btnSalvar.style.display='none';
  },200);

  // Pequeno delay para garantir que a página renderizou
  setTimeout(()=>{
    // Reseta tudo antes de preencher
    resetar();

    if(!s){
      // Produto antigo sem snapshot — preenche só o que temos
      const list=document.getElementById('items-list');
      list.innerHTML=`<div class="item-row"><input type="number" class="item-input" placeholder="Custo item 1 (R$)" min="0" step="0.01" value="${p.custoReal||0}"><button class="remove-btn" onclick="removeItem(this)">×</button></div>`;
      if(p.frete)document.getElementById('frete-manual').value=p.frete;
      switchFrete('manual');
      if(p.pI)document.getElementById('impostos').value=(p.pI*100).toFixed(2);
      if(p.pC)document.getElementById('comissao').value=(p.pC*100).toFixed(2);
      if(p.pA)document.getElementById('afiliados').value=(p.pA*100).toFixed(2);
      if(p.margem)document.getElementById('margem').value=p.margem.toFixed(2);
      if(p.precoML)document.getElementById('preco-ml').value=p.precoML;
      setMode(1);
      calcular();
      return;
    }

    // Restaura modo
    setMode(s.calcMode||1);

    // Restaura itens de custo
    const list=document.getElementById('items-list');
    const itens=s.itens&&s.itens.length?s.itens:[p.custoReal||0];
    list.innerHTML='';
    itens.forEach((v,i)=>{
      const d=document.createElement('div');d.className='item-row';
      d.innerHTML=`<input type="number" class="item-input" placeholder="Custo item ${i+1} (R$)" min="0" step="0.01" value="${v}"><button class="remove-btn" onclick="removeItem(this)" style="display:${itens.length>1?'flex':'none'}">×</button>`;
      list.appendChild(d);
    });

    // Restaura frete
    switchFrete(s.freteMode||'dim');
    if(s.freteMode==='manual'){
      document.getElementById('frete-manual').value=s.freteManual||0;
    }else{
      if(s.peso)document.getElementById('peso').value=s.peso;
      if(s.comp)document.getElementById('comp').value=s.comp;
      if(s.larg)document.getElementById('larg').value=s.larg;
      if(s.alt)document.getElementById('alt').value=s.alt;
      if(s.peso||s.comp)calcPeso();
      // Restaura seleção da faixa de frete se existia
      if(s.freteSel&&s.freteSel_col!==undefined){
        setTimeout(()=>selFrete(s.freteSel_col, s.freteSel), 100);
      }
    }

    // Restaura insumos e Full
    if(s.insumos)document.getElementById('insumos').value=s.insumos;
    if(s.freteFullTotal){
      toggleFreteFullVisivel(); // abre o painel
      document.getElementById('frete-full').value=s.freteFullTotal;
      if(s.freteFullQtd&&s.freteFullQtd>1)document.getElementById('frete-full-qtd').value=s.freteFullQtd;
      calcFreteFullUnit();
    }

    // Restaura taxas
    if(s.impostos)document.getElementById('impostos').value=s.impostos;
    if(s.comissao)document.getElementById('comissao').value=s.comissao;
    if(s.afiliados)document.getElementById('afiliados').value=s.afiliados;
    if(s.margem)document.getElementById('margem').value=s.margem;

    // Restaura projeção
    if(s.quantidade&&s.quantidade>1)document.getElementById('quantidade').value=s.quantidade;
    if(s.precoML)document.getElementById('preco-ml').value=s.precoML;

    // Executa o cálculo
    calcular();

  }, 100);
}

// ============================================================
// GESTÃO DE ESTOQUE — CALCULADORA DE GIRO
// ============================================================

function calcularGestao(){} // chamado no showPage, giro roda via oninput

function calcularGiro(){
  const qtd       = parseInt(document.getElementById('giro-qtd').value)||0;
  const valor     = parseMasked(document.getElementById('giro-valor'));
  const vendasDia = parseInt(document.getElementById('giro-vendas-dia').value)||0;
  const dataCompraStr  = document.getElementById('giro-data-compra').value;
  const dataInicioStr  = document.getElementById('giro-data-inicio').value;
  const prazo          = parseInt(document.getElementById('giro-prazo').value)||0;

  const resultado = document.getElementById('giro-resultado');
  const empty     = document.getElementById('giro-empty');

  if(!qtd||!vendasDia){resultado.style.display='none';empty.style.display='block';return;}

  resultado.style.display='block';
  empty.style.display='none';

  const custoUnit = qtd>0&&valor>0 ? valor/qtd : 0;
  const hoje = new Date(); hoje.setHours(0,0,0,0);

  // Dias de venda = desde o início das vendas (ou data de compra se não informado)
  let diasComp = 0;
  const dataRefStr = dataInicioStr || dataCompraStr;
  if(dataRefStr){
    const dataRef = new Date(dataRefStr+'T00:00:00');
    diasComp = Math.max(Math.round((hoje - dataRef)/(1000*60*60*24)), 0);
  }

  const jaVendido = Math.min(diasComp * vendasDia, qtd);
  const estoqueAtual = Math.max(qtd - jaVendido, 0);
  const diasRestantes = Math.floor(estoqueAtual / vendasDia);
  const fmtN = n => n.toLocaleString('pt-BR');

  document.getElementById('giro-estoque-atual').textContent = fmtN(estoqueAtual);
  const elDias = document.getElementById('giro-dias-restantes');
  elDias.textContent = diasRestantes;
  elDias.style.color = prazo>0&&diasRestantes<=prazo ? '#f87171' : diasRestantes<=10 ? '#F0A070' : '#4ade80';
  document.getElementById('giro-custo-unit').textContent = custoUnit>0 ? fmt(custoUnit) : '—';

  const alerta = document.getElementById('giro-alerta');
  if(prazo>0&&diasRestantes<=prazo){
    alerta.style.cssText='background:#7f1d1d33;border:1px solid #ef444455;border-radius:9px;padding:9px 13px;font-size:.78rem;color:#f87171;font-weight:700';
    alerta.textContent=`⚠️ Atenção! Seu estoque acaba em ${diasRestantes} dias mas o novo lote chega em ${prazo} dias. Faça o pedido agora!`;
  }else if(prazo>0&&diasRestantes<=prazo*1.5){
    alerta.style.cssText='background:#7c2d1233;border:1px solid #F0A07055;border-radius:9px;padding:9px 13px;font-size:.78rem;color:#F0A070;font-weight:600';
    alerta.textContent=`⏳ Fique de olho — você tem ${diasRestantes} dias de estoque. Prepare-se para pedir em breve.`;
  }else{
    alerta.style.cssText='background:#05291622;border:1px solid #16a34a44;border-radius:9px;padding:9px 13px;font-size:.78rem;color:#4ade80;font-weight:600';
    alerta.textContent=`✅ Estoque tranquilo por ${diasRestantes} dias.`;
  }

  function cenario(d){const q=vendasDia*d;return{qtd:q,valor:q*custoUnit};}
  const c5=cenario(5),c10=cenario(10),c15=cenario(15),c30=cenario(30);
  document.getElementById('giro-c5-qtd').textContent  = fmtN(c5.qtd)+' unid.';
  document.getElementById('giro-c5-val').textContent   = custoUnit>0?fmt(c5.valor):'—';
  document.getElementById('giro-c10-qtd').textContent = fmtN(c10.qtd)+' unid.';
  document.getElementById('giro-c10-val').textContent  = custoUnit>0?fmt(c10.valor):'—';
  document.getElementById('giro-c15-qtd').textContent = fmtN(c15.qtd)+' unid.';
  document.getElementById('giro-c15-val').textContent  = custoUnit>0?fmt(c15.valor):'—';
  document.getElementById('giro-c30-qtd').textContent = fmtN(c30.qtd)+' unid.';
  document.getElementById('giro-c30-val').textContent  = custoUnit>0?fmt(c30.valor):'—';

  const pontoRep = prazo>0 ? vendasDia*prazo : 0;
  document.getElementById('giro-ponto-rep').textContent = fmtN(pontoRep);

  const btnCal  = document.getElementById('btn-add-cal');
  const elData  = document.getElementById('giro-ponto-data');
  const elMsg   = document.getElementById('giro-ponto-msg');
  const elLabel = document.getElementById('giro-ponto-label');

  if(prazo>0){
    const diasAtePonto = Math.max(Math.floor((estoqueAtual-pontoRep)/vendasDia),0);
    const dataPedido = new Date(hoje);
    dataPedido.setDate(dataPedido.getDate()+diasAtePonto);
    const dataPedidoStr = dataPedido.toISOString().split('T')[0];
    const dataPedidoFmt = dataPedido.toLocaleDateString('pt-BR');
    // Data de entrega = data do pedido + prazo em dias
    const dataEntrega = new Date(dataPedido);
    dataEntrega.setDate(dataEntrega.getDate()+prazo);
    const dataEntregaStr = dataEntrega.toISOString().split('T')[0];
    const dataEntregaFmt = dataEntrega.toLocaleDateString('pt-BR');
    elData.textContent  = dataPedidoFmt;
    elLabel.textContent = diasAtePonto===0 ? '🔴 Peça HOJE!' : `em ${diasAtePonto} dias`;
    if(estoqueAtual<=pontoRep){
      elMsg.textContent=`Seu estoque já está no ponto de reposição. Faça o pedido agora! O lote chegaria em ${dataEntregaFmt}.`;
    }else{
      elMsg.textContent=`Em ${dataPedidoFmt} faça o pedido. O lote chegará em ${dataEntregaFmt} com estoque suficiente.`;
    }
    btnCal.style.display='block';
    btnCal.dataset.data = dataPedidoStr;
    btnCal.dataset.dataEntrega = dataEntregaStr;
    btnCal.textContent = '📅 Adicionar lembrete no Calendário';
    btnCal.disabled = false;
    btnCal.style.opacity = '1';
  }else{
    elData.textContent='—';
    elLabel.textContent='informe os dias do fornecedor';
    elMsg.textContent='Informe quantos dias o fornecedor demora para entregar para calcular quando fazer o pedido.';
    if(btnCal)btnCal.style.display='none';
  }
}

function adicionarGiroCalendario(){
  const btn = document.getElementById('btn-add-cal');
  const dataPedido   = btn.dataset.data;
  const dataEntrega  = btn.dataset.dataEntrega;
  if(!dataPedido) return;
  const evs = getEventos();
  const pedidoEv = {id:Date.now(), titulo:'🛒 Fazer pedido ao fornecedor', tipo:'giro_pedido', data:dataPedido, hora:'09:00', obs:'Ponto de reposição atingido — hora de pedir o novo lote', push:true};
  const entregaEv = dataEntrega ? {id:Date.now()+1, titulo:'📦 Chegada do novo lote', tipo:'giro_entrega', data:dataEntrega, hora:'', obs:'Entrega prevista do fornecedor', push:true} : null;
  evs.push(pedidoEv);
  if(entregaEv) evs.push(entregaEv);
  saveEventos(evs);
  if(Notification.permission==='granted'){
    agendarNotificacoesEvento(pedidoEv);
    if(entregaEv) agendarNotificacoesEvento(entregaEv);
  }
  btn.textContent='✅ Adicionado ao Calendário!';
  btn.disabled=true;
  btn.style.opacity='0.7';
  setTimeout(()=>{if(confirm('Eventos adicionados! Deseja ir ao Calendário agora?'))showPage('cal');},300);
}


// Máscara monetária R$ para inputs de texto
function maskReal(el){
  let v=el.value.replace(/\D/g,'');
  if(!v){el.value='';return;}
  v=(parseInt(v)/100).toFixed(2);
  el.value='R$ '+parseFloat(v).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
}

function parseMasked(el){
  return parseFloat((el.value||'').replace(/[R$\s.]/g,'').replace(',','.'))||0;
}

// ============================================================
// CALCULADORA DE PUBLICIDADE — ROAS/ACOS
// ============================================================
let pubMode = 'dash'; // 'dash' ou 'manual'

function switchPubMode(mode){
  pubMode = mode;
  const btnDash = document.getElementById('pub-btn-dash');
  const btnMan  = document.getElementById('pub-btn-manual');
  const secDash = document.getElementById('pub-sec-dash');
  const secMan  = document.getElementById('pub-sec-manual');
  if(mode==='dash'){
    btnDash.style.background='linear-gradient(135deg,#6B21A8,#F0A070)';
    btnDash.style.color='#fff';
    btnMan.style.background='none';
    btnMan.style.color='var(--text3)';
    secDash.style.display='block';
    secMan.style.display='none';
    carregarProdutosPublicidade();
  }else{
    btnMan.style.background='linear-gradient(135deg,#6B21A8,#F0A070)';
    btnMan.style.color='#fff';
    btnDash.style.background='none';
    btnDash.style.color='var(--text3)';
    secDash.style.display='none';
    secMan.style.display='block';
    calcularPublicidadeManual();
  }
}

async function carregarProdutosPublicidade(){
  const prods = JSON.parse(localStorage.getItem('realecom_prods')||'[]');
  const sel = document.getElementById('pub-produto-sel');
  if(!sel) return;
  if(!prods.length){
    sel.innerHTML='<option value="">Nenhum produto salvo ainda</option>';
    return;
  }
  sel.innerHTML='<option value="">Selecione um produto...</option>'+
    prods.map((p,i)=>`<option value="${i}">${p.nome} — ${p.precoCalc?'R$ '+p.precoCalc.toLocaleString('pt-BR',{minimumFractionDigits:2}):'—'}</option>`).join('');
  sel.onchange = ()=>selecionarProdutoPublicidade(prods);
}

function selecionarProdutoPublicidade(prods){
  const idx = document.getElementById('pub-produto-sel').value;
  const preview = document.getElementById('pub-preview');
  const lucroEl = document.getElementById('pub-lucro-dash');
  if(idx===''){preview.style.display='none';document.getElementById('pub-resultado').style.display='none';return;}
  const p = prods[parseInt(idx)];
  preview.style.display='grid';
  document.getElementById('pub-pre-custo').textContent  = fmt(p.custoReal||0);
  document.getElementById('pub-pre-preco').textContent  = fmt(p.precoCalc||0);
  document.getElementById('pub-pre-margem').textContent = (p.margem||0).toFixed(1)+'%';
  document.getElementById('pub-pre-payout').textContent = fmt(p.payout||0);
  if(lucroEl) lucroEl.value = '';
  calcularPublicidadeDash(p);
}

function calcularPublicidadeDash(p){
  const lucroDesejado = parseFloat(document.getElementById('pub-lucro-dash').value)||0;
  if(!p||!p.precoCalc) return;
  const taxaFrete = (p.frete||0) + (p.ins||0);
  const pI = p.pI||0, pC = p.pC||0, pA = p.pA||0;
  const custos = p.custoReal + taxaFrete + p.precoCalc*(pI+pC+pA);
  const margemAds = p.precoCalc - custos - (p.precoCalc*(lucroDesejado/100));
  renderResultadoPublicidade(p.precoCalc, margemAds);
}

function calcularPublicidadeManual(){
  const preco    = parseFloat(document.getElementById('pub-m-preco').value)||0;
  const custo    = parseFloat(document.getElementById('pub-m-custo').value)||0;
  const taxafrete= parseFloat(document.getElementById('pub-m-taxa').value)||0;
  const comissao = (parseFloat(document.getElementById('pub-m-comissao').value)||0)/100;
  const imposto  = (parseFloat(document.getElementById('pub-m-imposto').value)||0)/100;
  const lucro    = (parseFloat(document.getElementById('pub-m-lucro').value)||0)/100;
  if(!preco||!custo){document.getElementById('pub-resultado').style.display='none';return;}
  const custos = custo + taxafrete + preco*(comissao+imposto);
  const margemAds = preco - custos - (preco*lucro);
  renderResultadoPublicidade(preco, margemAds);
}

function renderResultadoPublicidade(preco, margemAds){
  const res = document.getElementById('pub-resultado');
  let alerta = document.getElementById('pub-alerta');
  if(!alerta){
    alerta = document.createElement('div');
    alerta.id = 'pub-alerta';
    alerta.style.cssText = 'background:#7f1d1d22;border:1px solid #ef444455;border-radius:10px;padding:10px 14px;font-size:.78rem;color:#f87171;margin-top:8px;line-height:1.5;display:none';
    res.parentNode.insertBefore(alerta, res);
  }
  if(margemAds<=0||preco<=0){
    res.style.display='none';
    alerta.style.display='block';
    if(margemAds<=0 && preco>0){
      alerta.textContent='⚠️ A margem que você quer garantir é igual ou maior que a margem do produto — não sobra nada para investir em anúncios. Reduza a margem desejada ou melhore o custo do produto.';
    } else {
      alerta.textContent='Preencha o preço e o custo do produto para calcular.';
    }
    return;
  }
  alerta.style.display='none';
  res.style.display='block';
  const acos = (margemAds/preco)*100;
  const roas = preco/margemAds;
  // Guarda contra valores absurdos (margemAds quase zero)
  if(!isFinite(roas)||roas>9999||acos<0.01){
    res.style.display='none';
    const al = document.getElementById('pub-alerta');
    if(al){al.style.display='block';al.textContent='⚠️ A margem que você quer garantir é igual ou maior que a margem do produto — não sobra nada para investir em anúncios. Reduza a margem desejada ou melhore o custo do produto.';}
    return;
  }
  document.getElementById('pub-roas').textContent = roas.toFixed(1)+'x';
  document.getElementById('pub-acos').textContent = acos.toFixed(1)+'%';
  document.getElementById('pub-margem-ads').textContent = fmt(margemAds);
  document.getElementById('pub-exp-roas').textContent = fmt(preco);
  document.getElementById('pub-exp-acos').textContent = acos.toFixed(1)+'%';
  document.getElementById('pub-exp-margem').textContent = fmt(margemAds);
  // Mostra campo de nome só no modo manual
  const nomeWrap=document.getElementById('pub-save-nome-wrap');
  if(nomeWrap) nomeWrap.style.display=pubMode==='manual'?'block':'none';
}

function toggleGlossario(){
  const body=document.getElementById('glossario-body');
  const arrow=document.getElementById('glossario-arrow');
  const open=body.style.display==='block';
  body.style.display=open?'none':'block';
  if(arrow)arrow.textContent=open?'▼':'▲';
}

function salvarAnalisePublicidade(){
  const roas=document.getElementById('pub-roas').textContent;
  const acos=document.getElementById('pub-acos').textContent;
  const margem=document.getElementById('pub-margem-ads').textContent;
  if(roas==='—'){alert('Calcule primeiro antes de salvar.');return;}

  let nome='';
  if(pubMode==='dash'){
    const idx=document.getElementById('pub-produto-sel').value;
    const prods=JSON.parse(localStorage.getItem('realecom_prods')||'[]');
    nome=idx!==''?prods[parseInt(idx)].nome:'Produto do Dashboard';
  }else{
    nome=document.getElementById('pub-m-nome').value.trim();
    if(!nome){alert('Informe o nome do produto para salvar.');document.getElementById('pub-m-nome').focus();return;}
  }

  const historico=JSON.parse(localStorage.getItem('realecom_pub_historico')||'[]');
  historico.unshift({id:Date.now(),nome,roas,acos,margem});
  localStorage.setItem('realecom_pub_historico',JSON.stringify(historico));
  renderHistoricoPublicidade();
  alert('✅ Análise salva!');
}

function renderHistoricoPublicidade(){
  const historico=JSON.parse(localStorage.getItem('realecom_pub_historico')||'[]');
  const wrap=document.getElementById('pub-historico-wrap');
  const el=document.getElementById('pub-historico');
  if(!wrap||!el)return;
  if(!historico.length){wrap.style.display='none';return;}
  wrap.style.display='block';
  el.innerHTML=historico.map(h=>`
    <div class="prod-item" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:7px">
      <div style="font-weight:700;color:var(--text);font-size:.82rem">${h.nome}</div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;font-size:.78rem;align-items:center">
        <span>ROAS: <strong style="color:#c4b5fd">${h.roas}</strong></span>
        <span>ACOS: <strong style="color:#4ade80">${h.acos}</strong></span>
        <span>Margem ads: <strong style="color:var(--o)">${h.margem}</strong></span>
        <button onclick="removerAnalisePublicidade(${h.id})" style="background:none;border:none;color:#4a3f6b;cursor:pointer;font-size:.85rem;padding:2px 5px" title="Remover">×</button>
      </div>
    </div>`).join('');
}

function removerAnalisePublicidade(id){
  const historico=JSON.parse(localStorage.getItem('realecom_pub_historico')||'[]').filter(h=>h.id!==id);
  localStorage.setItem('realecom_pub_historico',JSON.stringify(historico));
  renderHistoricoPublicidade();
}

// ============================================================
const SN_ANEXO1 = [
  {faixa:'1ª Faixa', min:0.01,       max:180000,    nominal:0.04,  deducao:0,      irpj:0.055, csll:0.035, cofins:0.1274, pis:0.0276, cpp:0.415,  icms:0.34},
  {faixa:'2ª Faixa', min:180000.01,  max:360000,    nominal:0.073, deducao:5940,   irpj:0.055, csll:0.035, cofins:0.1274, pis:0.0276, cpp:0.415,  icms:0.34},
  {faixa:'3ª Faixa', min:360000.01,  max:720000,    nominal:0.095, deducao:13860,  irpj:0.055, csll:0.035, cofins:0.1274, pis:0.0276, cpp:0.42,   icms:0.335},
  {faixa:'4ª Faixa', min:720000.01,  max:1800000,   nominal:0.107, deducao:22500,  irpj:0.055, csll:0.035, cofins:0.1274, pis:0.0276, cpp:0.42,   icms:0.335},
  {faixa:'5ª Faixa', min:1800000.01, max:3600000,   nominal:0.143, deducao:87300,  irpj:0.055, csll:0.035, cofins:0.1274, pis:0.0276, cpp:0.42,   icms:0.335},
  {faixa:'6ª Faixa', min:3600000.01, max:4800000,   nominal:0.19,  deducao:378000, irpj:0.135, csll:0.1,   cofins:0.2827, pis:0.0613, cpp:0.421,  icms:0},
];

function calcularSimples(){
  const rbt12  = parseMasked(document.getElementById('sn-rbt12'));
  const mensal = parseMasked(document.getElementById('sn-mensal'));
  const res    = document.getElementById('sn-resultado');
  const empty  = document.getElementById('sn-empty');

  if(!rbt12||!mensal){res.style.display='none';empty.style.display='block';empty.innerHTML='<div style="font-size:2.5rem">🧾</div><p style="font-size:.8rem;color:#888;margin-top:8px;line-height:1.6">Preencha o faturamento acima<br>para ver os cálculos</p>';return;}

  const faixaObj=SN_ANEXO1.find(f=>rbt12>=f.min&&rbt12<=f.max);
  if(!faixaObj){
    res.style.display='none';empty.style.display='block';
    empty.innerHTML='<div style="font-size:2.5rem">⚠️</div><p style="font-size:.8rem;color:#f87171;margin-top:8px">Faturamento acima do limite do Simples Nacional (R$ 4,8 milhões/ano)</p>';
    return;
  }

  const aliqEfetiva=(rbt12*faixaObj.nominal-faixaObj.deducao)/rbt12;
  const das=mensal*aliqEfetiva;
  res.style.display='block';empty.style.display='none';

  const fmtPct=v=>(v*100).toFixed(2).replace('.',',')+' %';
  const fmtRange=f=>'R$ '+(f.min).toLocaleString('pt-BR',{maximumFractionDigits:0})+' – R$ '+(f.max).toLocaleString('pt-BR',{maximumFractionDigits:0});

  document.getElementById('sn-faixa').textContent        =faixaObj.faixa;
  document.getElementById('sn-faixa-range').textContent  =fmtRange(faixaObj);
  document.getElementById('sn-aliq-efetiva').textContent =fmtPct(aliqEfetiva);
  document.getElementById('sn-das').textContent          =fmt(das);
  document.getElementById('sn-d-rbt12').textContent      =fmt(rbt12);
  document.getElementById('sn-d-nominal').textContent    =fmtPct(faixaObj.nominal);
  document.getElementById('sn-d-deducao').textContent    =fmt(faixaObj.deducao);
  document.getElementById('sn-d-efetiva').textContent    =fmtPct(aliqEfetiva);
  document.getElementById('sn-d-mensal').textContent     =fmt(mensal);
  document.getElementById('sn-d-das').textContent        =fmt(das);

  const tributos=[
    {nome:'IRPJ',   pct:faixaObj.irpj,   cor:'#60a5fa'},
    {nome:'CSLL',   pct:faixaObj.csll,   cor:'#a78bfa'},
    {nome:'Cofins', pct:faixaObj.cofins, cor:'#f472b6'},
    {nome:'PIS',    pct:faixaObj.pis,    cor:'#fb923c'},
    {nome:'CPP',    pct:faixaObj.cpp,    cor:'#4ade80'},
    {nome:'ICMS',   pct:faixaObj.icms,   cor:'#facc15'},
  ].filter(t=>t.pct>0);

  document.getElementById('sn-tributos').innerHTML=tributos.map(t=>`
    <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px;text-align:center;border-top:3px solid ${t.cor}">
      <div style="font-size:.65rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:${t.cor};margin-bottom:4px">${t.nome}</div>
      <div style="font-size:.82rem;font-weight:800;color:var(--text)">${fmt(das*t.pct)}</div>
      <div style="font-size:.65rem;color:var(--text3);margin-top:2px">${fmtPct(t.pct)} do DAS</div>
    </div>`).join('');
}

// ============================================================
// METAS — Nova versão com períodos
// ============================================================

function carregarMetas(){
  const m=JSON.parse(localStorage.getItem('realecom_metas')||'{}');
  const elDia=document.getElementById('meta-prod-dia');
  const elDias=document.getElementById('meta-dias-semana');
  if(m.prodDia&&elDia)elDia.value=m.prodDia;
  if(m.diasSemana&&elDias)elDias.value=m.diasSemana;
  atualizarQualidade();
  if(m.prodDia&&m.diasSemana)recalcularMetas();
}

function atualizarQualidade(){
  if(!document.getElementById('qual-total'))return;
  const m=JSON.parse(localStorage.getItem('realecom_metas')||'{}');
  const dataInicio=m.dataInicio?new Date(m.dataInicio):new Date(0);
  const todos=JSON.parse(localStorage.getItem('realecom_prods')||'[]');

  const agora=Date.now();
  const limite30=agora-(30*24*60*60*1000);
  const prodsMes=todos.filter(p=>{
    const ts=typeof p.id==='number'?p.id:parseInt(p.id);
    return ts>=limite30;
  });

  const qualTotal=document.getElementById('qual-total');
  if(qualTotal)qualTotal.textContent=prodsMes.length;

  const roi160=prodsMes.filter(p=>p.margem&&parseFloat(p.margem)>=10&&parseFloat(p.margem)<15).length;
  const roi180=prodsMes.filter(p=>p.margem&&parseFloat(p.margem)>=15&&parseFloat(p.margem)<20).length;
  const roi200=prodsMes.filter(p=>p.margem&&parseFloat(p.margem)>=20).length;

  const q160=document.getElementById('qual-roi160');
  const q180=document.getElementById('qual-roi180');
  const q200=document.getElementById('qual-roi200');
  if(q160)q160.textContent=roi160;
  if(q180)q180.textContent=roi180;
  if(q200)q200.textContent=roi200;

  const comML=prodsMes.filter(p=>p.precoML&&p.precoML>0);
  const ticketMedio=comML.length>0?(comML.reduce((s,p)=>s+parseFloat(p.precoML),0)/comML.length):0;
  const qTicket=document.getElementById('qual-ticket');
  if(qTicket)qTicket.textContent=ticketMedio>0?'R$ '+ticketMedio.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2}):'R$ —';
}

function salvarMetas(){
  const prodDia=parseInt(document.getElementById('meta-prod-dia').value)||0;
  const diasSemana=parseInt(document.getElementById('meta-dias-semana').value)||0;
  if(!prodDia||!diasSemana){
    alert('Preencha os campos: quantos produtos por dia e quantos dias por semana.');
    return;
  }
  const m=JSON.parse(localStorage.getItem('realecom_metas')||'{}');
  m.prodDia=prodDia;
  m.diasSemana=diasSemana;
  if(!m.dataInicio)m.dataInicio=new Date().toISOString();
  try{
    localStorage.setItem('realecom_metas',JSON.stringify(m));
    fbSet('metas', m);
    recalcularMetas();
    alert('✅ Metas salvas com sucesso!');
  }catch(e){
    alert('Erro ao salvar: '+e.message);
  }
}

function atualizarNota(v){
  document.getElementById('nota-display').textContent=parseFloat(v).toFixed(1).replace('.',',');
}

function recalcularMetas(){
  const elDia=document.getElementById('meta-prod-dia');
  const elDias=document.getElementById('meta-dias-semana');
  if(!elDia||!elDias)return;
  const prodDia=parseInt(elDia.value)||0;
  const diasSem=parseInt(elDias.value)||0;
  if(!prodDia||!diasSem)return;

  const metaSemana=prodDia*diasSem;
  const metaQuinzena=metaSemana*2;
  const metaMes=metaSemana*4;

  document.getElementById('meta-resumo').style.display='block';
  document.getElementById('meta-val-semana').textContent=metaSemana+' produtos';
  document.getElementById('meta-val-quinzena').textContent=metaQuinzena+' produtos';
  document.getElementById('meta-val-mes').textContent=metaMes+' produtos';

  const m=JSON.parse(localStorage.getItem('realecom_metas')||'{}');
  const dataInicio=m.dataInicio?new Date(m.dataInicio):new Date();
  const prods=JSON.parse(localStorage.getItem('realecom_prods')||'[]');

  function prodsPeriodo(dias){
    const agora=Date.now();
    const limiteMs=agora-(dias*24*60*60*1000);
    const limiteReal=Math.max(dataInicio.getTime(),limiteMs);
    return prods.filter(p=>{
      const ts=typeof p.id==='number'?p.id:parseInt(p.id);
      return ts>=limiteReal;
    });
  }

  const prodsSemana=prodsPeriodo(7);
  const prodsQuinzena=prodsPeriodo(15);
  const prodsMes=prodsPeriodo(30);
  function comprados(lista){return lista.filter(p=>p.comprado).length;}

  function atualizarGrafico(prefix,lista,meta,circumference){
    const qtd=lista.length,comp=comprados(lista);
    const pct=meta>0?Math.min(Math.round((qtd/meta)*100),100):0;
    const offset=circumference-(pct/100)*circumference;
    const circle=document.getElementById('circle-'+prefix);
    if(circle){
      circle.style.strokeDashoffset=offset;
      circle.style.transition='stroke-dashoffset .8s ease';
      if(pct>=100)circle.setAttribute('stroke','#4ade80');
    }
    const pctEl=document.getElementById('pct-'+prefix+'-num');
    if(pctEl)pctEl.textContent=pct+'%';
    const faltam=Math.max(meta-qtd,0);
    const infoEl=document.getElementById('info-'+prefix);
    if(infoEl){
      infoEl.innerHTML=`<strong style="color:var(--text);font-size:.75rem">${qtd}/${meta}</strong> produtos<br>`+
        (comp>0?`<span style="color:#4ade80">⭐ ${comp} comprado${comp>1?'s':''}</span>`:'<span style="color:var(--text3)">nenhum comprado</span>');
    }
    const resumoEl=document.getElementById('resumo-'+prefix);
    if(resumoEl){
      const cor=pct>=100?'#4ade80':pct>=50?'#F0A070':'#c4b5fd';
      resumoEl.innerHTML=`<span style="color:${cor};font-weight:700">${pct>=100?'🎉':'📍'} ${prefix==='semana'?'Esta semana':prefix==='quinzena'?'Quinzena':'Este mês'}:</span> `+
        `${qtd} produto${qtd!==1?'s':''} analisado${qtd!==1?'s':''}${comp>0?` · <strong style="color:#4ade80">${comp} comprado${comp>1?'s':''}</strong>`:''}.  `+
        (faltam>0?`Faltam <strong style="color:var(--o)">${faltam}</strong> para bater a meta.`:`<strong style="color:#4ade80">Meta atingida!</strong>`);
    }
    return {pct,qtd,comp};
  }

  document.getElementById('resumo-geral').style.display='block';
  const s=atualizarGrafico('semana',prodsSemana,metaSemana,314);
  const q=atualizarGrafico('quinzena',prodsQuinzena,metaQuinzena,314);
  const mn=atualizarGrafico('mes',prodsMes,metaMes,314);

  atualizarQualidade();
}

// ============================================================
// FRETE FULL — cálculo por unidade
// ============================================================
function calcFreteFullUnit(){
  const total=parseFloat(document.getElementById('frete-full').value)||0;
  const qtd=parseInt(document.getElementById('frete-full-qtd').value)||0;
  const res=document.getElementById('frete-full-result');
  const uni=document.getElementById('frete-full-unit');
  if(total>0&&qtd>0){
    const porUnit=total/qtd;
    res.style.display='block';
    uni.textContent=fmt(porUnit)+' por unidade';
  }else{
    res.style.display='none';
  }
}

// ============================================================
// DEVOLUÇÃO
// ============================================================
function calcRanqueamento(){
  if(!lastCalc)return;
  const precoRank=parseFloat(document.getElementById('rank-preco').value)||0;
  const qtdRank=parseInt(document.getElementById('rank-qtd').value)||0;
  const res=document.getElementById('rank-resultado');
  if(!precoRank||!qtdRank){res.style.display='none';return;}

  const {pI,pC,pA,custo,frete,ins}=lastCalc;
  const vI=precoRank*pI,vC=precoRank*pC,vA=precoRank*pA;
  const payoutRank=precoRank-custo-frete-ins-vI-vC-vA;
  const fatTotal=precoRank*qtdRank;
  const lucroTotal=payoutRank*qtdRank;
  const impacto=lastCalc.payout>0?(lastCalc.payout-payoutRank)*qtdRank:null;

  res.style.display='block';
  document.getElementById('rank-fat').textContent=fmt(fatTotal);

  const elLucro=document.getElementById('rank-lucro');
  elLucro.textContent=fmt(lucroTotal);
  elLucro.style.color=lucroTotal>=0?'#4ade80':'#f87171';

  const elImpacto=document.getElementById('rank-impacto');
  if(impacto!==null){
    elImpacto.textContent=fmt(Math.abs(impacto));
    elImpacto.style.color=impacto>0?'#f87171':'#4ade80';
    document.getElementById('rank-impacto-label').textContent=impacto>0?'Deixou de ganhar':'Ganho extra vs preço ideal';
  }

  const elPayUnit=document.getElementById('rank-pay-unit');
  elPayUnit.textContent=fmt(payoutRank)+'/unid.';
  elPayUnit.style.color=payoutRank>=0?'#4ade80':'#f87171';
}

function calcDevolucao(){
  const taxa=parseFloat(document.getElementById('dev-taxa').value)||0;
  const msg=document.getElementById('dev-msg');
  const vendasEl=document.getElementById('dev-vendas');
  if(taxa<=0){
    vendasEl.textContent='—';
    msg.textContent='Informe o valor da taxa de devolução para calcular.';
    return;
  }
  const vendasNecessarias=Math.ceil(taxa/lastCalc.payout);
  vendasEl.textContent=vendasNecessarias;
  msg.textContent=`Com lucro de ${fmt(lastCalc.payout)} por unidade, você precisa fazer ${vendasNecessarias} venda${vendasNecessarias>1?'s':''} para cobrir uma devolução de ${fmt(taxa)}.`;
}

// ============================================================
// BUSCADOR DE NCM — busca local aprimorada
// ============================================================
const BASE_NCM = [
  // VESTUÁRIO MASCULINO
  {cod:'6105.10.00', desc:'Camisetas de malha de algodão para homens', palavras:'camiseta camisa polo malha algodao homem masculino basica dry fit academia'},
  {cod:'6105.20.00', desc:'Camisetas de malha de fibras sintéticas para homens', palavras:'camiseta camisa malha sintetica poliester masculino dry fit esporte'},
  {cod:'6109.10.00', desc:'T-shirts e camisetas interiores de algodão', palavras:'tshirt camiseta basica algodao regata interior branca preta'},
  {cod:'6203.42.00', desc:'Calças e bermudas de algodão para homens', palavras:'calca bermuda shorts jeans algodao masculino homem cargo jogger'},
  {cod:'6203.32.00', desc:'Jaquetas e blusões de fibras sintéticas para homens', palavras:'jaqueta blusao corta vento sintetica masculino homem'},
  {cod:'6203.22.00', desc:'Conjuntos de algodão para homens', palavras:'conjunto moletom algodao masculino agasalho'},
  // VESTUÁRIO FEMININO
  {cod:'6106.10.00', desc:'Blusas e camiseiros de malha de algodão para mulheres', palavras:'blusa blusao camiseiro malha algodao feminino mulher'},
  {cod:'6104.62.00', desc:'Calças e bermudas de algodão para mulheres', palavras:'calca bermuda legging algodao feminino mulher'},
  {cod:'6204.62.00', desc:'Calças e jardineiras de algodão para mulheres', palavras:'calca jeans algodao feminino mulher jardeira'},
  {cod:'6104.13.00', desc:'Casacos e jaquetas de malha sintética para mulheres', palavras:'casaco jaqueta malha sintetica feminino mulher'},
  {cod:'6104.43.00', desc:'Vestidos de malha sintética para mulheres', palavras:'vestido malha sintetica feminino mulher'},
  {cod:'6108.21.00', desc:'Camisolas e pijamas de algodão para mulheres', palavras:'pijama camisola algodao feminino mulher dormir'},
  // VESTUÁRIO INFANTIL
  {cod:'6111.20.00', desc:'Vestuário de malha de algodão para bebês', palavras:'roupa bebe malha algodao infantil recem nascido body'},
  {cod:'6209.20.00', desc:'Vestuário de algodão para bebês', palavras:'roupa bebe algodao infantil crianca macacão'},
  {cod:'6110.20.10', desc:'Suéteres e pulôveres de algodão para crianças', palavras:'sueter pulover moletom algodao crianca infantil'},
  // ACESSÓRIOS VESTUÁRIO
  {cod:'6217.10.00', desc:'Acessórios de vestuário de malha', palavras:'gorro touca luva lenco cachecol acessorio malha'},
  {cod:'6214.20.00', desc:'Xales, lenços e cachecóis de lã', palavras:'xale lenco cachecol la frio inverno'},
  {cod:'6215.20.00', desc:'Gravatas e laços de seda ou fibras sintéticas', palavras:'gravata laco borboleta seda sintetica'},
  // CALÇADOS
  {cod:'6404.11.00', desc:'Tênis esportivos com sola de borracha e cabedal têxtil', palavras:'tenis esportivo corrida borracha textil sport academia running'},
  {cod:'6404.19.00', desc:'Calçados casuais com sola de borracha e cabedal têxtil', palavras:'tenis casual sapatenis lona borracha textil'},
  {cod:'6403.91.00', desc:'Calçados de couro com sola de borracha para adultos', palavras:'sapato social couro borracha adulto masculino feminino'},
  {cod:'6402.99.00', desc:'Sandálias e chinelos de borracha ou plástico', palavras:'sandalia chinelo havaianas borracha plastico praia'},
  {cod:'6401.92.00', desc:'Botas impermeáveis com biqueira protetora', palavras:'bota impermeavel biqueira protecao seguranca trabalho'},
  {cod:'6403.51.00', desc:'Calçados de couro com biqueira metálica', palavras:'sapato social couro biqueira metal seguranca'},
  {cod:'6405.20.00', desc:'Calçados com cabedal de matéria têxtil (outros)', palavras:'alpargata espadrille textil simples'},
  // ELETRÔNICOS — ÁUDIO
  {cod:'8518.30.00', desc:'Fones de ouvido (headphone/headset)', palavras:'fone ouvido headphone headset auricular bluetooth sem fio gamer'},
  {cod:'8518.21.00', desc:'Alto-falantes em caixas acústicas', palavras:'caixa som alto falante speaker bluetooth portatil'},
  {cod:'8518.22.00', desc:'Alto-falantes múltiplos em caixas acústicas', palavras:'caixa som home theater subwoofer'},
  {cod:'8518.10.00', desc:'Microfones', palavras:'microfone estudio condensador dinamico usb'},
  // ELETRÔNICOS — TELEFONIA
  {cod:'8517.12.31', desc:'Telefone celular portátil (smartphone)', palavras:'celular smartphone telefone movel iphone android samsung'},
  {cod:'8517.12.13', desc:'Outros aparelhos telefônicos sem fio', palavras:'telefone sem fio fixo residencial'},
  // ELETRÔNICOS — INFORMÁTICA
  {cod:'8471.30.12', desc:'Notebooks e laptops até 3,5kg', palavras:'notebook laptop computador portatil leve ultrafino'},
  {cod:'8471.41.10', desc:'Computadores desktop', palavras:'computador desktop pc mesa torre processador'},
  {cod:'8471.60.52', desc:'Teclados para computadores', palavras:'teclado computador mecanico membrana gamer wireless'},
  {cod:'8471.60.53', desc:'Mouses para computadores', palavras:'mouse raton gamer optico wireless sem fio'},
  {cod:'8528.72.20', desc:'Monitores de vídeo colorido', palavras:'monitor tela display computador gamer 4k'},
  {cod:'8523.51.10', desc:'Cartões de memória flash e pen drives', palavras:'pendrive cartao memoria flash usb sd micro'},
  {cod:'8504.40.40', desc:'Carregadores e fontes de alimentação', palavras:'carregador celular fonte adaptador notebook tomada'},
  {cod:'8507.60.00', desc:'Baterias e acumuladores de íons de lítio', palavras:'bateria litio powerbank carregador portatil'},
  {cod:'8443.32.29', desc:'Impressoras jato de tinta ou laser', palavras:'impressora jato tinta laser multifuncional'},
  // ELETRÔNICOS — CÂMERAS
  {cod:'9006.52.00', desc:'Máquinas fotográficas digitais', palavras:'camera fotografica digital reflex mirrorless'},
  {cod:'8525.80.29', desc:'Câmeras de vídeo e action cameras', palavras:'camera video action cam gopro filmadora'},
  {cod:'8525.80.11', desc:'Webcams e câmeras para computador', palavras:'webcam camera computador streaming videoconferencia'},
  // ELETRÔNICOS — WEARABLES
  {cod:'9102.12.00', desc:'Relógios de pulso eletrônicos (smartwatch)', palavras:'smartwatch relogio inteligente pulso digital smart'},
  {cod:'8543.70.99', desc:'Pulseiras e rastreadores de atividade fitness', palavras:'pulseira fitness rastreador atividade banda smart'},
  // ELETRÔNICOS — TV E VÍDEO
  {cod:'8528.72.10', desc:'Televisores de tela plana', palavras:'televisao tv tela plana lcd led oled smart'},
  {cod:'8521.90.19', desc:'Aparelhos de gravação e reprodução de vídeo', palavras:'dvd blu ray player reprodutor video'},
  // BOLSAS E ACESSÓRIOS
  {cod:'4202.12.00', desc:'Malas e mochilas de plástico ou matéria têxtil', palavras:'mochila mala bolsa viagem nylon poliester tecido'},
  {cod:'4202.22.00', desc:'Bolsas de mão de matéria têxtil', palavras:'bolsa mao carteira clutch feminina textil tecido'},
  {cod:'4202.11.00', desc:'Malas e maletas de couro natural', palavras:'mala maleta couro viagem executiva'},
  {cod:'4202.31.00', desc:'Carteiras e porta-documentos de couro', palavras:'carteira porta documentos couro masculino feminino'},
  {cod:'4205.00.00', desc:'Cintos e correias de couro', palavras:'cinto couro masculino feminino'},
  // CASA E DECORAÇÃO
  {cod:'3924.10.00', desc:'Louças e artigos domésticos de plástico', palavras:'pote vasilha caixa organizador plastico cozinha domestico'},
  {cod:'3924.90.00', desc:'Outros artigos domésticos de plástico', palavras:'balde bacia plastico domestico'},
  {cod:'6302.60.00', desc:'Toalhas de banho e mesa de algodão', palavras:'toalha banho mesa algodao'},
  {cod:'9404.90.00', desc:'Almofadas travesseiros e artigos de cama', palavras:'almofada travesseiro edredom colcha cama'},
  {cod:'6303.92.00', desc:'Cortinas e persianas de fibras sintéticas', palavras:'cortina persiana blackout sintetica'},
  {cod:'7323.93.00', desc:'Artefatos de aço inoxidável para uso doméstico', palavras:'panela frigideira aco inox cozinha'},
  {cod:'7323.94.00', desc:'Artefatos de ferro ou aço para uso doméstico', palavras:'forma assadeira ferro aco cozinha forno'},
  {cod:'8516.60.00', desc:'Fornos elétricos e micro-ondas', palavras:'forno eletrico micro ondas cozinha'},
  {cod:'8516.40.00', desc:'Ferros elétricos de passar roupa', palavras:'ferro passar roupa eletrico vapor'},
  {cod:'8509.40.00', desc:'Batedeiras e misturadores de alimentos', palavras:'batedeira liquidificador mixer processador alimento cozinha'},
  {cod:'8509.80.00', desc:'Aspiradores de pó', palavras:'aspirador po eletrico domestico'},
  // MÓVEIS
  {cod:'9403.20.00', desc:'Móveis de metal para uso doméstico', palavras:'rack suporte prateleira metal movel estante'},
  {cod:'9403.30.00', desc:'Móveis de madeira para escritório', palavras:'mesa cadeira escritorio madeira'},
  {cod:'9403.60.00', desc:'Móveis de madeira para uso doméstico', palavras:'armario guarda roupa estante madeira quarto'},
  {cod:'9401.61.00', desc:'Assentos com armação de madeira estofados', palavras:'sofa poltrona cadeira madeira estofada'},
  // BANHEIRO — ESPELHOS E ARMÁRIOS
  {cod:'7009.92.00', desc:'Espelhos de vidro com moldura', palavras:'espelho moldura banheiro quarto parede vidro'},
  {cod:'3922.10.00', desc:'Banheiras e artigos sanitários de plástico', palavras:'armario banheiro plastico pvc sanitario'},
  {cod:'7615.10.00', desc:'Artigos de uso doméstico de alumínio', palavras:'armario banheiro aluminio espelho'},
  // BELEZA E CUIDADOS
  {cod:'3304.10.00', desc:'Produtos de maquiagem para lábios', palavras:'batom lip gloss labial brilho maquiagem'},
  {cod:'3304.20.00', desc:'Preparações para maquiagem dos olhos', palavras:'mascara rimel sombra delineador base olhos maquiagem'},
  {cod:'3304.99.90', desc:'Outras preparações de beleza e maquiagem', palavras:'base po facial blush contorno maquiagem'},
  {cod:'3305.10.00', desc:'Xampus para cabelo', palavras:'xampu shampoo cabelo higiene limpeza'},
  {cod:'3305.30.00', desc:'Laquês para cabelo', palavras:'laque spray fixador cabelo'},
  {cod:'3307.20.00', desc:'Desodorantes corporais e antitranspirantes', palavras:'desodorante antitranspirante roll on aerosol corpo'},
  {cod:'3401.11.90', desc:'Sabões de toucador em barras', palavras:'sabao sabonete barra higiene banho'},
  {cod:'3307.10.00', desc:'Preparações para barbear', palavras:'creme gel espuma barbear barba'},
  {cod:'3304.30.00', desc:'Preparações para manicure e pedicure', palavras:'esmalte unha removedor acetona manicure'},
  // ESPORTE E FITNESS
  {cod:'9506.62.00', desc:'Bolas de futebol, basquete e outros esportes', palavras:'bola futebol basquete volei tenis esporte'},
  {cod:'9506.91.00', desc:'Artigos e equipamentos para ginástica', palavras:'halter haltere peso musculacao fitness caneleira'},
  {cod:'9506.11.00', desc:'Esquis e artigos de esqui aquático', palavras:'esqui prancha surf wakeboard'},
  {cod:'9506.99.00', desc:'Outros artigos para esportes e lazer', palavras:'corda pular elástico exercicio treino'},
  {cod:'9507.10.00', desc:'Varas de pesca', palavras:'vara pesca molinete carretilha pesca'},
  // BRINQUEDOS
  {cod:'9503.00.31', desc:'Brinquedos com motor elétrico', palavras:'brinquedo eletrico motor controle remoto carro drone'},
  {cod:'9503.00.10', desc:'Bonecas e bonecos', palavras:'boneca boneco bebe barbie action figure'},
  {cod:'9503.00.99', desc:'Outros brinquedos', palavras:'brinquedo plastico crianca educativo'},
  {cod:'9504.50.00', desc:'Consoles e máquinas de videogame', palavras:'videogame console playstation xbox nintendo joystick controle'},
  {cod:'9504.90.00', desc:'Jogos de tabuleiro, cartas e similares', palavras:'jogo tabuleiro carta baralho xadrez'},
  // PETS
  {cod:'4201.00.00', desc:'Arreios e artigos para animais', palavras:'coleira guia peitoral cachorro gato pet'},
  {cod:'9508.90.00', desc:'Artigos e acessórios para animais de estimação', palavras:'cama casinha brinquedo pet comedouro bebedouro'},
  {cod:'2309.10.00', desc:'Alimentos para cães e gatos', palavras:'racao cachorro gato pet alimento'},
  // FERRAMENTAS
  {cod:'8467.19.00', desc:'Ferramentas elétricas de uso manual', palavras:'furadeira parafusadeira lixadeira esmerilhadeira eletrica'},
  {cod:'8205.20.00', desc:'Martelos e marretas', palavras:'martelo marreta ferramenta manual'},
  {cod:'8211.93.00', desc:'Facas de mesa e de cozinha', palavras:'faca cozinha cutelaria chef corte'},
  // PAPELARIA E ESCRITÓRIO
  {cod:'4820.10.20', desc:'Cadernos escolares e universitários', palavras:'caderno escolar universitario espiral'},
  {cod:'9608.10.00', desc:'Canetas esferográficas', palavras:'caneta esferografica bic escrita'},
  {cod:'9612.10.00', desc:'Fitas para impressoras e máquinas de escrever', palavras:'toner cartucho tinta impressora'},
  // SUPLEMENTOS E SAÚDE
  {cod:'2106.90.90', desc:'Preparações alimentícias diversas (suplementos)', palavras:'suplemento proteina whey creatina bcaa pre treino'},
  {cod:'3004.50.99', desc:'Medicamentos e vitaminas embalados para venda a retalho', palavras:'vitamina suplemento capsulas comprimido'},
  // AUTOMÓVEIS E ACESSÓRIOS
  {cod:'8708.99.90', desc:'Partes e acessórios para veículos automóveis', palavras:'acessorio carro auto veiculo'},
  {cod:'8512.20.00', desc:'Aparelhos de iluminação para veículos', palavras:'farol lanterna luz led carro moto'},
  {cod:'4011.10.00', desc:'Pneus novos para automóveis', palavras:'pneu carro automovel borracha'},
];

// Normaliza texto removendo acentos
function normalizarTexto(t){
  return t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z0-9\s]/g,'');
}

// Score de relevância entre query e NCM
function calcularScore(query, ncm){
  const tokens = normalizarTexto(query).split(/\s+/).filter(t=>t.length>2);
  const haystack = normalizarTexto(ncm.desc + ' ' + ncm.palavras);
  let score = 0;
  tokens.forEach(t=>{
    const re = new RegExp('\\b'+t, 'g');
    const matches = (haystack.match(re)||[]).length;
    if(matches>0) score += t.length * matches * 2;
    else if(haystack.includes(t)) score += t.length;
  });
  tokens.forEach(t=>{
    if(normalizarTexto(ncm.desc).includes(t)) score += 5;
  });
  return score;
}

let ncmSelecionado = null;

function buscarNCM(){
  const query = document.getElementById('ncm-input').value.trim();
  if(!query){alert('Digite o nome do produto.');return;}
  _executarBuscaNCM(query);
}

function ncmAtalho(termo){
  document.getElementById('ncm-input').value = termo;
  _executarBuscaNCM(termo);
}

function _executarBuscaNCM(query){
  const box = document.getElementById('ncm-resultados-box');
  const lista = document.getElementById('ncm-lista');
  const empty = document.getElementById('ncm-empty');
  const titulo = document.getElementById('ncm-resultado-titulo');

  empty.style.display='none';

  const resultados = BASE_NCM
    .map(n=>({...n, score:calcularScore(query,n)}))
    .filter(n=>n.score>0)
    .sort((a,b)=>b.score-a.score)
    .slice(0,5);

  if(!resultados.length){
    box.style.display='none';
    empty.style.display='block';
    empty.style.opacity='1';
    empty.querySelector('p').textContent='Nenhum NCM encontrado. Tente descrever o material e o uso do produto.';
    return;
  }

  box.style.display='block';
  titulo.textContent=`${resultados.length} resultado${resultados.length>1?'s':''} encontrado${resultados.length>1?'s':''}`;

  lista.innerHTML=resultados.map((n,i)=>`
    <div onclick="selecionarNCM('${n.cod}','${n.desc.replace(/'/g,"\'")}',${n.score})" style="border:${i===0?'1.5px solid #0f766e88':'1px solid var(--border)'};background:${i===0?'#0f766e12':'var(--bg2)'};border-radius:9px;padding:10px 12px;cursor:pointer;transition:all .2s;margin-bottom:${i<resultados.length-1?'7px':'0'}">
      <div style="font-size:.82rem;font-weight:800;font-family:monospace;color:${i===0?'#0d9488':'var(--text)'};margin-bottom:3px">${n.cod}</div>
      <div style="font-size:.72rem;color:var(--text2);line-height:1.4">${n.desc}</div>
    </div>`).join('');

  selecionarNCM(resultados[0].cod, resultados[0].desc, resultados[0].score, false);
}

function selecionarNCM(cod, desc, score, salvarHist=true){
  ncmSelecionado = {cod, desc};
  document.getElementById('ncm-detalhe').style.display='block';
  document.getElementById('ncm-detalhe-empty').style.display='none';
  document.getElementById('ncm-codigo-display').textContent=cod;
  document.getElementById('ncm-desc-display').textContent=desc;

  if(salvarHist){
    const query=document.getElementById('ncm-input').value.trim();
    const hist=JSON.parse(localStorage.getItem('realecom_ncm_hist')||'[]');
    const jaExiste=hist.findIndex(h=>h.cod===cod);
    if(jaExiste>=0) hist.splice(jaExiste,1);
    hist.unshift({cod,desc,query});
    localStorage.setItem('realecom_ncm_hist',JSON.stringify(hist.slice(0,10)));
    renderHistoricoNCM();
  }
}

function copiarNCM(){
  if(!ncmSelecionado) return;
  navigator.clipboard.writeText(ncmSelecionado.cod).then(()=>{
    mostrarNotifMsg({tipo:'outro',data:''},'Código NCM copiado: '+ncmSelecionado.cod,1);
  }).catch(()=>{
    prompt('Copie o código NCM:',ncmSelecionado.cod);
  });
}

function renderHistoricoNCM(){
  const hist=JSON.parse(localStorage.getItem('realecom_ncm_hist')||'[]');
  const box=document.getElementById('ncm-historico-box');
  const lista=document.getElementById('ncm-historico-lista');
  if(!box||!lista) return;
  if(!hist.length){box.style.display='none';return;}
  box.style.display='block';
  lista.innerHTML=hist.map((h,i)=>`
    <div onclick="ncmAtalho('${h.query}')" style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;${i<hist.length-1?'border-bottom:1px solid var(--border)':''};cursor:pointer">
      <span style="font-size:.76rem;color:var(--text2)">${h.query||h.desc.substring(0,30)}</span>
      <span style="font-size:.7rem;font-family:monospace;color:var(--text3)">${h.cod}</span>
    </div>`).join('');
}

function limparHistoricoNCM(){
  localStorage.removeItem('realecom_ncm_hist');
  renderHistoricoNCM();
}

// ============================================================
// WHATSAPP — cadastro de telefone
// ============================================================

// Salva telefone no Firestore e localStorage
async function salvarTelefone(){
  const input = document.getElementById('wpp-telefone');
  if(!input) return;
  const tel = input.value.replace(/\D/g,'');
  if(tel.length < 10 || tel.length > 11){
    alert('Informe um número válido com DDD (ex: 21999998888)');
    return;
  }
  try{
    const uid = await getUserId();
    if(!uid){ alert('Você precisa estar logado.'); return; }
    const db = await getDB();
    await db.collection('usuarios').doc(uid).set({ telefone: tel }, { merge: true });
    localStorage.setItem('realecom_telefone', tel);
    atualizarBannerWhatsApp(tel);
    mostrarNotifMsg({tipo:'outro',data:''},'✅ Número salvo! Você receberá lembretes no WhatsApp.',1);
  }catch(e){
    alert('Erro ao salvar: ' + e.message);
  }
}

// Remove telefone
async function removerTelefone(){
  if(!confirm('Deseja parar de receber notificações no WhatsApp?')) return;
  try{
    const uid = await getUserId();
    if(!uid) return;
    const db = await getDB();
    await db.collection('usuarios').doc(uid).update({ telefone: firebase.firestore.FieldValue.delete() });
    localStorage.removeItem('realecom_telefone');
    atualizarBannerWhatsApp(null);
    mostrarNotifMsg({tipo:'outro',data:''},'Notificações WhatsApp desativadas.',1);
  }catch(e){
    alert('Erro: ' + e.message);
  }
}

// Atualiza o banner no calendário conforme estado
function atualizarBannerWhatsApp(tel){
  const banner = document.getElementById('wpp-banner');
  if(!banner) return;
  if(tel){
    const formatado = tel.replace(/(\d{2})(\d{2})(\d{4,5})(\d{4})/, '+$1 ($2) $3-$4');
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="width:36px;height:36px;background:#16a34a;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="white"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        </div>
        <div style="flex:1">
          <div style="font-size:.82rem;font-weight:700;color:#4ade80">✅ WhatsApp ativo</div>
          <div style="font-size:.7rem;color:var(--text3)">${formatado} · lembretes automáticos ativados</div>
        </div>
        <button onclick="removerTelefone()" style="background:#7f1d1d22;border:1px solid #ef444444;color:#f87171;border-radius:7px;padding:5px 10px;font-size:.72rem;font-weight:600;cursor:pointer">Remover</button>
      </div>`;
  } else {
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <div style="width:36px;height:36px;background:#16a34a22;border:1px solid #16a34a44;border-radius:9px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="#4ade80"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
        </div>
        <div style="flex:1">
          <div style="font-size:.82rem;font-weight:700;color:var(--text)">Receba lembretes no WhatsApp</div>
          <div style="font-size:.7rem;color:var(--text3)">Cadastre seu número e receba os mesmos avisos do calendário direto no zap</div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <input type="tel" id="wpp-telefone" placeholder="DDD + número" maxlength="11"
            style="padding:7px 10px;border:1.5px solid #16a34a44;border-radius:8px;background:var(--bg2);color:var(--text);font-size:.82rem;outline:none;width:150px;font-family:inherit"
            onkeydown="if(event.key==='Enter')salvarTelefone()">
          <button onclick="salvarTelefone()" style="background:#16a34a;border:none;color:#fff;border-radius:8px;padding:7px 14px;font-size:.78rem;font-weight:700;cursor:pointer;white-space:nowrap">Ativar</button>
        </div>
      </div>`;
  }
}

// Carrega telefone ao entrar no calendário
async function carregarTelefoneWhatsApp(){
  const banner = document.getElementById('wpp-banner');
  if(!banner) return;
  // Tenta do cache primeiro
  const cache = localStorage.getItem('realecom_telefone');
  if(cache){ atualizarBannerWhatsApp(cache); return; }
  // Busca no Firestore
  try{
    const uid = await getUserId();
    if(!uid){ atualizarBannerWhatsApp(null); return; }
    const db = await getDB();
    const doc = await db.collection('usuarios').doc(uid).get();
    if(doc.exists && doc.data().telefone){
      localStorage.setItem('realecom_telefone', doc.data().telefone);
      atualizarBannerWhatsApp(doc.data().telefone);
    } else {
      atualizarBannerWhatsApp(null);
    }
  }catch(e){
    atualizarBannerWhatsApp(null);
  }
}
