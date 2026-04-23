// ============================================================
// CONFIGURAÇÃO — substitua pela URL do seu Apps Script
// ============================================================
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxmXTOx6jF3vcyziEedXtjeleTjOJTQtNGNh-8fmL0GcBGKa20rgAt-0YARiElFjp4CWg/exec';
const SESSAO_DURACAO_H = 24; // horas que a sessão fica válida

// ============================================================
// LOGIN
// ============================================================
function verificarSessao(){
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

function sair(){
  if(!confirm('Deseja sair da sua conta?'))return;
  localStorage.removeItem('realecom_sessao');
  location.reload();
}

async function fazerLogin(){
  const chave=document.getElementById('login-chave').value.trim().toUpperCase();
  if(!chave){mostrarErroLogin('Digite sua chave de acesso.');return;}

  const btn=document.getElementById('btn-login');
  const erro=document.getElementById('login-erro');
  const loading=document.getElementById('login-loading');
  const validade=document.getElementById('login-validade');

  btn.disabled=true;
  erro.style.display='none';
  validade.style.display='none';
  loading.style.display='block';

  try{
    const url=`${APPS_SCRIPT_URL}?chave=${encodeURIComponent(chave)}`;
    const res=await fetch(url);
    const data=await res.json();

    loading.style.display='none';

    if(data.ok){
      salvarSessao({chave,nome:data.nome,email:data.email,validade:data.validade});
      validade.style.display='block';
      validade.textContent=`✅ Bem-vindo, ${data.nome}! Acesso válido até ${data.validade}.`;
      setTimeout(()=>entrarNoApp(data),1200);
    }else{
      mostrarErroLogin(data.erro||'Chave inválida.');
      btn.disabled=false;
    }
  }catch(e){
    loading.style.display='none';
    mostrarErroLogin('Erro de conexão. Verifique sua internet e tente novamente.');
    btn.disabled=false;
  }
}

function mostrarErroLogin(msg){
  const el=document.getElementById('login-erro');
  el.textContent=msg;
  el.style.display='block';
}

function entrarNoApp(dados, pagina){
  const hu=document.getElementById('home-usuario');
  if(hu&&dados&&dados.nome){
    hu.innerHTML=`👋 Olá, <strong style="color:var(--o)">${dados.nome}</strong> · Acesso válido até <strong>${dados.validade}</strong>`;
  }
  setTimeout(()=>showPage(pagina||'home', true), 50);
}

// Verifica sessão ao carregar
(function(){
  const s=verificarSessao();
  if(s){
    const ultimaPagina=localStorage.getItem('realecom_pagina')||'home';
    entrarNoApp(s, ultimaPagina);
  }
  const t=localStorage.getItem('realecom_theme');
  if(t==='light'){document.body.classList.add('light');document.querySelectorAll('.theme-toggle').forEach(b=>b.textContent='🌙 Escuro');}
})();

// ============================================================
// APP
// ============================================================
const pesoFaixas=[[0,.3],[.3,.5],[.5,1],[1,1.5],[1.5,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],[9,11],[11,13],[13,15],[15,17],[17,20],[20,25],[25,30],[30,40],[40,50],[50,60],[60,70],[70,80],[80,90],[90,100],[100,125],[125,150],[150,1e9]];
const pesoLabels=['Até 0,3kg','0,3–0,5kg','0,5–1kg','1–1,5kg','1,5–2kg','2–3kg','3–4kg','4–5kg','5–6kg','6–7kg','7–8kg','8–9kg','9–11kg','11–13kg','13–15kg','15–17kg','17–20kg','20–25kg','25–30kg','30–40kg','40–50kg','50–60kg','60–70kg','70–80kg','80–90kg','90–100kg','100–125kg','125–150kg','+150kg'];
const precoFaixas=[0,19,49,79,100,120,150,200];
const precoLabels=['R$0–18','R$19–48','R$49–78','R$79–99','R$100–119','R$120–149','R$150–199','R$200+'];
const T=[[5.65,6.55,7.75,12.35,14.35,16.45,18.45,20.95],[5.95,6.65,7.85,13.25,15.45,17.65,19.85,22.55],[6.05,6.75,7.95,13.85,16.15,18.45,20.75,23.65],[6.15,6.85,8.05,14.15,16.45,18.85,21.15,24.65],[6.25,6.95,8.15,14.45,16.85,19.25,21.65,24.65],[6.35,7.95,8.55,15.75,18.35,21.05,23.65,26.25],[6.45,8.15,8.95,17.05,19.85,22.65,25.55,28.35],[6.55,8.35,9.75,18.45,21.55,24.65,27.75,30.75],[6.65,8.55,9.95,25.45,28.55,32.65,35.75,39.75],[6.75,8.75,10.15,27.05,31.05,36.05,40.05,44.05],[6.85,8.95,10.35,28.85,33.65,38.45,43.25,48.05],[6.95,9.15,10.55,29.65,34.55,39.55,44.45,49.35],[7.05,9.55,10.95,41.25,48.05,54.95,61.75,68.65],[7.15,9.95,11.35,42.15,49.25,56.25,63.25,70.25],[7.25,10.15,11.55,45.05,52.45,59.95,67.45,74.95],[7.35,10.35,11.75,48.55,56.05,63.55,70.75,78.65],[7.45,10.55,11.95,54.75,63.85,72.95,82.05,91.15],[7.65,10.95,12.15,64.05,75.05,84.75,95.35,105.95],[7.75,11.15,12.35,65.95,75.45,85.55,96.25,106.95],[7.85,11.35,12.55,67.75,78.95,88.95,99.15,107.05],[7.95,11.55,12.75,70.25,81.05,92.05,102.55,110.75],[8.05,11.75,12.95,74.95,86.45,98.15,109.35,118.15],[8.15,11.95,13.15,80.25,92.95,105.05,117.15,126.55],[8.25,12.15,13.35,83.95,97.05,109.85,122.45,132.25],[8.35,12.35,13.55,93.25,107.45,122.05,136.05,146.95],[8.45,12.55,13.75,106.55,123.95,139.55,155.55,167.95],[8.55,12.75,13.95,119.25,138.05,156.05,173.95,187.95],[8.65,12.75,14.15,126.55,146.15,165.65,184.65,199.45],[8.75,12.75,14.35,166.15,192.45,217.55,242.55,261.95]];

let pesoUsado=0,freteSel=0,freteSel_col=undefined,freteMode='dim',lastCalc=null,calcMode=1;
let calAno=new Date().getFullYear(),calMes=new Date().getMonth(),evEditId=null;

function fmt(v){return'R$ '+v.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});}
function fmtKg(v){return v%1===0?v.toFixed(0)+' kg':v.toFixed(v<1?3:2)+' kg';}
function fmtP(v){return v.toFixed(2).replace('.',',')+' %';}

function showPage(p,bypassCheck){
  if(p!=='login'&&!bypassCheck&&!verificarSessao()){location.reload();return;}
  document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));
  document.getElementById('page-'+p).classList.add('active');
  if(p==='dash')renderDash();
  if(p==='cal')renderCal();
  if(p==='metas')carregarMetas();
  if(p==='gestao')calcularGestao();
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
    document.getElementById('mode-desc').innerHTML='<strong style="color:var(--o)">Modo Por Margem:</strong> Defina sua margem e descubra o preço mínimo ideal.';
    document.getElementById('price-grid').style.gridTemplateColumns='1fr 1fr';
    document.getElementById('pc-ml-card').style.display='block';
  }else{
    b2.style.background='linear-gradient(135deg,#6B21A8,#F0A070)';b2.style.color='#fff';
    b1.style.background='none';b1.style.color='#4a3f6b';
    mb.style.display='none';mlInput.placeholder='Obrigatório';
    mlLabel.innerHTML='💛 Preço Médio ML (R$) <span style="color:#f87171">*</span>';
    document.getElementById('mode-desc').innerHTML='<strong style="color:var(--o)">Modo Pelo Mercado:</strong> Informe o preço médio ML e descubra sua margem real.';
  }
}

function calcular(){
  const custo=sumItems();
  const frete=freteMode==='manual'?(parseFloat(document.getElementById('frete-manual').value)||0):freteSel;
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
  document.getElementById('proj-qtd').textContent=qtd;
  document.getElementById('proj-cu').textContent=fmt(custo);
  document.getElementById('proj-inv').textContent=fmt(inv);
  document.getElementById('proj-imp').textContent=fmt(totalImp);
  document.getElementById('proj-fat').textContent=fmt(preco*qtd);
  document.getElementById('proj-pay').textContent=fmt(payout);
  document.getElementById('proj-lb').textContent=fmt(payout*qtd);
  document.getElementById('proj-cx-bruto').textContent=fmt(inv+payout*qtd+totalImp);
  document.getElementById('proj-cx').textContent=fmt(inv+payout*qtd);
}

function finalizarCalculo(){
  document.getElementById('inpi-box').style.display='block';
  document.getElementById('right-empty').style.display='none';
  document.getElementById('right-result').style.display='block';
  if(lastCalc&&lastCalc.payout>0){
    calcDevolucao();
  }
}

function resetar(){
  document.getElementById('right-empty').style.display='flex';
  document.getElementById('right-result').style.display='none';
  document.getElementById('inpi-box').style.display='none';
  document.getElementById('frete-full').value='';
  document.getElementById('frete-full-qtd').value='';
  document.getElementById('frete-full-result').style.display='none';
  document.getElementById('dev-taxa').value='';
  lastCalc=null;
}

// ============================================================
// SALVAR PRODUTO — métricas do Preço ML no card, preço da margem nos detalhes
// ============================================================
function salvarProduto(){
  if(!lastCalc)return;
  const nome=document.getElementById('save-nome').value.trim();
  if(!nome){alert('Informe o nome do produto.');return;}

  // Fator para cálculo do custo ideal (margem definida ou 15% como fallback)
  const margemDefinida=lastCalc.pM>0?lastCalc.pM:0.15;
  const fator=1-lastCalc.pI-lastCalc.pC-lastCalc.pA-margemDefinida;

  // Preço calculado para atingir a margem desejada e seu lucro
  const precoMargem=fator>0?lastCalc.base/fator:null;
  let lucroMargem=null;
  if(precoMargem!==null){
    const vI=precoMargem*lastCalc.pI,vC=precoMargem*lastCalc.pC,vA=precoMargem*lastCalc.pA;
    lucroMargem=precoMargem-lastCalc.base-vI-vC-vA;
  }

  // Custo ideal = custo máximo para ter a margem vendendo no preço ML
  const custoIdeal=(lastCalc.precoML>0&&fator>0)?(lastCalc.precoML*fator-lastCalc.frete-lastCalc.ins):null;

  // Métricas do Preço Médio ML (exibidas no card principal)
  let precoML_roi=0,precoML_margem=0,precoML_markup=0,precoML_payout=0;
  if(lastCalc.precoML>0){
    const mlvI=lastCalc.precoML*lastCalc.pI,mlvC=lastCalc.precoML*lastCalc.pC,mlvA=lastCalc.precoML*lastCalc.pA;
    const mlPayout=lastCalc.precoML-lastCalc.base-mlvI-mlvC-mlvA;
    precoML_payout=mlPayout;
    precoML_margem=(mlPayout/lastCalc.precoML)*100;
    precoML_markup=lastCalc.custo>0?lastCalc.precoML/lastCalc.custo:0;
    const inv=lastCalc.custo*lastCalc.qtd;
    precoML_roi=inv>0?(mlPayout*lastCalc.qtd/inv)*100:0;
  }

  const prod={
    id:Date.now(),
    nome,
    forn:document.getElementById('save-forn').value.trim()||'—',
    cod:document.getElementById('save-cod').value.trim()||'—',
    obs:document.getElementById('save-obs').value.trim(),
    // Custos
    custoReal:lastCalc.custo,
    custoIdeal:custoIdeal!==null?Math.max(custoIdeal,0):null,
    // Preço calculado para a margem desejada e seu lucro
    precoCalc:precoMargem!==null?precoMargem:lastCalc.preco,
    lucroMargem:lucroMargem!==null?lucroMargem:lastCalc.payout,
    // Preço Médio ML e suas métricas (exibidas no card)
    precoML:lastCalc.precoML,
    precoML_roi,
    precoML_margem,
    precoML_markup,
    precoML_payout,
    // Compat retroativa — mantidos para produtos antigos já salvos
    markup:precoML_markup||lastCalc.markup,
    roi:precoML_roi||lastCalc.roi,
    margem:precoML_margem||lastCalc.pM*100,
    payout:precoML_payout||lastCalc.payout
  };

  const prods=JSON.parse(localStorage.getItem('realecom_prods')||'[]');
  prods.unshift(prod);localStorage.setItem('realecom_prods',JSON.stringify(prods));
  document.getElementById('save-nome').value='';document.getElementById('save-forn').value='';document.getElementById('save-cod').value='';document.getElementById('save-obs').value='';
  alert('✅ Produto salvo no Dashboard!');
}

function salvarObs(id,val){const prods=JSON.parse(localStorage.getItem('realecom_prods')||'[]');const p=prods.find(p=>p.id===id);if(p){p.obs=val;localStorage.setItem('realecom_prods',JSON.stringify(prods));}}
function deletarProduto(id){if(!confirm('Remover este produto?'))return;const prods=JSON.parse(localStorage.getItem('realecom_prods')||'[]').filter(p=>p.id!==id);localStorage.setItem('realecom_prods',JSON.stringify(prods));renderDash();}
function toggleDetail(id){const det=document.getElementById('det-'+id);const btn=document.getElementById('tbtn-'+id);const open=det.style.display==='block';det.style.display=open?'none':'block';btn.textContent=open?'+ detalhes':'− fechar';}

// ============================================================
// DASHBOARD — card mostra métricas do Preço ML; detalhes mostram preço da margem
// ============================================================
function renderDash(){
  const prods=JSON.parse(localStorage.getItem('realecom_prods')||'[]');
  const el=document.getElementById('dash-content');
  if(!prods.length){el.innerHTML='<div style="text-align:center;padding:60px 20px;opacity:.25;color:#888"><p style="font-size:2rem">📦</p><br><p style="font-size:.85rem">Nenhum produto salvo ainda.</p></div>';return;}
  el.innerHTML=prods.map(p=>{
    // Métricas do card: usa precoML_* se disponível, senão fallback para campos antigos
    const roi   = p.precoML>0 ? (p.precoML_roi    ?? p.roi)    : p.roi;
    const margem= p.precoML>0 ? (p.precoML_margem ?? p.margem) : p.margem;
    const markup= p.precoML>0 ? (p.precoML_markup ?? p.markup) : p.markup;

    const rc=roi>=10?'#4ade80':roi>=5?'#F0A070':'#f87171';
    const mc=margem>=10?'#4ade80':margem>=5?'#F0A070':'#f87171';
    const mkc=markup>=1.5?'#4ade80':markup>=1.2?'#F0A070':'#f87171';

    // Detalhes
    const custoIdealStr=p.custoIdeal!==null&&p.custoIdeal!==undefined?fmt(p.custoIdeal):'—';
    const precoMargem=p.precoCalc?fmt(p.precoCalc):'—';
    const lucroMargem=p.lucroMargem!==undefined?fmt(p.lucroMargem):(p.payout!==undefined?fmt(p.payout):'—');
    const lucroML=p.precoML>0&&p.precoML_payout!==undefined?fmt(p.precoML_payout):'—';

    return`<div class="prod-card" style="${p.comprado?'border-color:#16a34a55;':''}"><div class="prod-card-top">
      <div class="prod-name"><h3>${p.nome}${p.comprado?' <span style="background:#16a34a22;color:#4ade80;border-radius:20px;padding:2px 8px;font-size:.65rem;font-weight:700">✅ Comprado</span>':''}</h3><p>🏭 ${p.forn} · ${p.cod}</p></div>
      <div class="prod-metric"><div class="pm-label">Preço ML</div><div class="pm-value" style="color:#F0A070">${p.precoML>0?fmt(p.precoML):'—'}</div></div>
      <div class="prod-metric"><div class="pm-label">ROI</div><div class="pm-value" style="color:${rc}">${fmtP(roi)}</div></div>
      <div class="prod-metric"><div class="pm-label">Margem</div><div class="pm-value" style="color:${mc}">${fmtP(margem)}</div></div>
      <div class="prod-metric"><div class="pm-label">Markup</div><div class="pm-value" style="color:${mkc}">${markup.toFixed(2).replace('.',',')}</div></div>
      <button onclick="toggleComprado(${p.id})" title="${p.comprado?'Desmarcar como comprado':'Marcar como comprado'}" style="background:${p.comprado?'#16a34a22':'none'};border:1px solid ${p.comprado?'#16a34a55':'var(--border)'};border-radius:8px;padding:6px 10px;cursor:pointer;font-size:1rem;transition:all .2s" onmouseover="this.style.borderColor='#16a34a'" onmouseout="this.style.borderColor='${p.comprado?'#16a34a55':'var(--border)'}'">${p.comprado?'⭐':'☆'}</button>
      <button class="btn-toggle" id="tbtn-${p.id}" onclick="toggleDetail(${p.id})">+ detalhes</button>
      <button class="btn-del" onclick="deletarProduto(${p.id})" title="Remover"><svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg></button>
    </div>
    <div class="prod-card-detail" id="det-${p.id}">
      <div class="prod-detail-grid">
        <div class="pd-item"><div class="pdl">Custo Real</div><div class="pdv">${fmt(p.custoReal)}</div></div>
        <div class="pd-item"><div class="pdl">Custo Ideal</div><div class="pdv" style="color:${p.custoIdeal!==null&&p.custoIdeal!==undefined?'#4ade80':'#4a3f6b'}">${custoIdealStr}</div></div>
        <div class="pd-item"><div class="pdl">Preço p/ Margem</div><div class="pdv" style="color:#c4b5fd">${precoMargem}</div></div>
        <div class="pd-item"><div class="pdl">Lucro p/ Margem</div><div class="pdv" style="color:#c4b5fd">${lucroMargem}</div></div>
        <div class="pd-item"><div class="pdl">Lucro Preço ML</div><div class="pdv" style="color:#F0A070">${lucroML}</div></div>
      </div>
      <div style="font-size:.62rem;color:var(--text3);text-transform:uppercase;letter-spacing:.08em;font-weight:700;margin-bottom:5px">📝 Observações</div>
      <textarea class="prod-obs" onchange="salvarObs(${p.id},this.value)" placeholder="Anotações...">${p.obs||''}</textarea>
    </div></div>`;
  }).join('');
}

// CALENDÁRIO
const tipoInfo={full:{icon:'📦',label:'Coleta Full',cls:'full'},conta:{icon:'💰',label:'Vencimento de Conta',cls:'conta'},entrega:{icon:'🚚',label:'Entrega',cls:'entrega'},outro:{icon:'📌',label:'Outro',cls:'outro'}};
const diasSemana=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'];
const meses=['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
function getEventos(){return JSON.parse(localStorage.getItem('realecom_eventos')||'[]');}
function saveEventos(evs){localStorage.setItem('realecom_eventos',JSON.stringify(evs));}
function navMes(dir){calMes+=dir;if(calMes>11){calMes=0;calAno++;}if(calMes<0){calMes=11;calAno--;}renderCal();}

function renderCal(){
  document.getElementById('cal-titulo').textContent=`${meses[calMes]} ${calAno}`;
  const grid=document.getElementById('cal-grid');
  const eventos=getEventos();
  const hoje=new Date();
  const primeiroDia=new Date(calAno,calMes,1).getDay();
  const diasNoMes=new Date(calAno,calMes+1,0).getDate();
  let h='';
  diasSemana.forEach(d=>h+=`<div class="cal-day-header">${d}</div>`);
  for(let i=0;i<primeiroDia;i++){const d=new Date(calAno,calMes,0).getDate()-primeiroDia+i+1;h+=`<div class="cal-day other-month"><div class="day-num">${d}</div></div>`;}
  for(let d=1;d<=diasNoMes;d++){
    const dataStr=`${calAno}-${String(calMes+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isHoje=hoje.getFullYear()===calAno&&hoje.getMonth()===calMes&&hoje.getDate()===d;
    const evsDia=eventos.filter(e=>e.data===dataStr);
    const max=3;
    let evsHtml=evsDia.slice(0,max).map(e=>`<div class="cal-event ${tipoInfo[e.tipo].cls}" onclick="event.stopPropagation();abrirModal('${dataStr}',${e.id})" title="${e.titulo}">${tipoInfo[e.tipo].icon} ${e.titulo}</div>`).join('');
    if(evsDia.length>max)evsHtml+=`<div class="cal-event-more">+${evsDia.length-max} mais</div>`;
    h+=`<div class="cal-day${isHoje?' today':''}" onclick="abrirModal('${dataStr}')"><div class="day-num">${d}</div>${evsHtml}</div>`;
  }
  const total=primeiroDia+diasNoMes;
  const resto=total%7===0?0:7-(total%7);
  for(let i=1;i<=resto;i++)h+=`<div class="cal-day other-month"><div class="day-num">${i}</div></div>`;
  grid.innerHTML=h;
}

function abrirModal(data,evId){
  evEditId=evId||null;
  const ev=evId?getEventos().find(e=>e.id===evId):null;
  document.getElementById('ev-data').value=ev?ev.data:(data||new Date().toISOString().split('T')[0]);
  document.getElementById('ev-titulo').value=ev?ev.titulo:'';
  document.getElementById('ev-hora').value=ev?ev.hora:'';
  document.getElementById('ev-obs').value=ev?ev.obs:'';
  document.getElementById('ev-tipo').value=ev?ev.tipo:'full';
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

function fecharModal(){document.getElementById('modal-overlay').classList.remove('open');evEditId=null;}

function excluirEvento(){
  if(!evEditId)return;
  if(!confirm('Excluir este evento?'))return;
  saveEventos(getEventos().filter(e=>e.id!==evEditId));
  fecharModal();renderCal();
}

function salvarEvento(){
  const titulo=document.getElementById('ev-titulo').value.trim();
  if(!titulo){alert('Informe o título do evento.');return;}
  const evs=getEventos();
  if(evEditId){
    const idx=evs.findIndex(e=>e.id===evEditId);
    if(idx>=0)evs[idx]={...evs[idx],titulo,tipo:document.getElementById('ev-tipo').value,data:document.getElementById('ev-data').value,hora:document.getElementById('ev-hora').value,obs:document.getElementById('ev-obs').value.trim()};
  }else{
    evs.push({id:Date.now(),titulo,tipo:document.getElementById('ev-tipo').value,data:document.getElementById('ev-data').value,hora:document.getElementById('ev-hora').value,obs:document.getElementById('ev-obs').value.trim()});
  }
  saveEventos(evs);fecharModal();renderCal();
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

document.addEventListener('wheel',e=>{if(document.activeElement&&document.activeElement.type==='number')e.preventDefault();},{passive:false});
verificarNotificacoes();

function exportarExcel(){
  const prods=JSON.parse(localStorage.getItem('realecom_prods')||'[]');
  if(!prods.length){alert('Nenhum produto no Dashboard para exportar.');return;}
  const fmt2=(v)=>typeof v==='number'?v.toFixed(2).replace('.',','):v||'';
  const rows=[['Nome','Fornecedor','Código','Custo Real (R$)','Custo Ideal (R$)','Preço p/ Margem (R$)','Preço Médio ML (R$)','Lucro p/ Margem (R$)','Lucro ML (R$)','Markup','ROI (%)','Margem (%)','Observações']];
  prods.forEach(p=>{
    const roi   = p.precoML>0?(p.precoML_roi    ?? p.roi)   :p.roi;
    const margem= p.precoML>0?(p.precoML_margem ?? p.margem):p.margem;
    const markup= p.precoML>0?(p.precoML_markup ?? p.markup):p.markup;
    rows.push([
      p.nome||'',p.forn||'',p.cod||'',
      fmt2(p.custoReal),
      p.custoIdeal!==null&&p.custoIdeal!==undefined?fmt2(p.custoIdeal):'',
      fmt2(p.precoCalc),
      p.precoML>0?fmt2(p.precoML):'',
      p.lucroMargem!==undefined?fmt2(p.lucroMargem):fmt2(p.payout),
      p.precoML>0&&p.precoML_payout!==undefined?fmt2(p.precoML_payout):'',
      markup?markup.toFixed(2).replace('.',','):'',
      fmt2(roi),fmt2(margem),p.obs||''
    ]);
  });
  const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(';')).join('\r\n');
  const blob=new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8;'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=`dashboard_realecom_${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.csv`;
  document.body.appendChild(a);a.click();
  document.body.removeChild(a);URL.revokeObjectURL(url);
}

// ============================================================
// DASHBOARD — toggleComprado
// ============================================================
function toggleComprado(id){
  const prods=JSON.parse(localStorage.getItem('realecom_prods')||'[]');
  const p=prods.find(p=>p.id===id);
  if(p){p.comprado=!p.comprado;localStorage.setItem('realecom_prods',JSON.stringify(prods));renderDash();}
}

// ============================================================
// GESTÃO DE ESTOQUE — CALCULADORA DE GIRO
// ============================================================

function calcularGestao(){} // chamado no showPage, giro roda via oninput

function calcularGiro(){
  const qtd      = parseInt(document.getElementById('giro-qtd').value)||0;
  const valor    = parseFloat(document.getElementById('giro-valor').value)||0;
  const vendasDia= parseInt(document.getElementById('giro-vendas-dia').value)||0;
  const diasComp = parseInt(document.getElementById('giro-dias-compra').value)||0;
  const prazo    = parseInt(document.getElementById('giro-prazo').value)||0;

  const resultado = document.getElementById('giro-resultado');
  const empty     = document.getElementById('giro-empty');

  if(!qtd||!vendasDia){
    resultado.style.display='none';
    empty.style.display='block';
    return;
  }

  resultado.style.display='block';
  empty.style.display='none';

  const custoUnit = qtd>0&&valor>0 ? valor/qtd : 0;

  const jaVendido = Math.min(diasComp * vendasDia, qtd);
  const estoqueAtual = Math.max(qtd - jaVendido, 0);
  const diasRestantes = Math.floor(estoqueAtual / vendasDia);

  const fmtN = n => n.toLocaleString('pt-BR');

  document.getElementById('giro-estoque-atual').textContent = fmtN(estoqueAtual);
  const elDias = document.getElementById('giro-dias-restantes');
  elDias.textContent = diasRestantes;
  elDias.style.color = diasRestantes<=prazo ? '#f87171' : diasRestantes<=prazo*1.5 ? '#F0A070' : '#4ade80';

  document.getElementById('giro-custo-unit').textContent = custoUnit>0 ? fmt(custoUnit) : '—';

  const alerta = document.getElementById('giro-alerta');
  if(diasRestantes <= prazo && prazo > 0){
    alerta.style.cssText='background:#7f1d1d33;border:1px solid #ef444455;border-radius:9px;padding:9px 13px;font-size:.78rem;color:#f87171;font-weight:700';
    alerta.textContent=`⚠️ Atenção! Seu estoque acaba em ${diasRestantes} dias mas o novo lote demora ${prazo} dias para chegar. Faça o pedido agora!`;
  }else if(diasRestantes <= prazo*1.5 && prazo > 0){
    alerta.style.cssText='background:#7c2d1233;border:1px solid #F0A07055;border-radius:9px;padding:9px 13px;font-size:.78rem;color:#F0A070;font-weight:600';
    alerta.textContent=`⏳ Fique de olho — você tem ${diasRestantes} dias de estoque e o lote demora ${prazo} dias. Prepare-se para pedir em breve.`;
  }else{
    alerta.style.cssText='background:#05291622;border:1px solid #16a34a44;border-radius:9px;padding:9px 13px;font-size:.78rem;color:#4ade80;font-weight:600';
    alerta.textContent=`✅ Estoque tranquilo por ${diasRestantes} dias. Você tem tempo para planejar o próximo pedido.`;
  }

  function cenario(diasCobertura){
    const precisaComprar = vendasDia * diasCobertura;
    return {qtd: precisaComprar, valor: precisaComprar * custoUnit};
  }

  const c5  = cenario(5);
  const c10 = cenario(10);
  const c15 = cenario(15);
  const c30 = cenario(30);

  document.getElementById('giro-c5-qtd').textContent  = fmtN(c5.qtd)+' unid.';
  document.getElementById('giro-c5-val').textContent   = custoUnit>0 ? fmt(c5.valor)  : '—';
  document.getElementById('giro-c10-qtd').textContent = fmtN(c10.qtd)+' unid.';
  document.getElementById('giro-c10-val').textContent  = custoUnit>0 ? fmt(c10.valor) : '—';
  document.getElementById('giro-c15-qtd').textContent = fmtN(c15.qtd)+' unid.';
  document.getElementById('giro-c15-val').textContent  = custoUnit>0 ? fmt(c15.valor) : '—';
  document.getElementById('giro-c30-qtd').textContent = fmtN(c30.qtd)+' unid.';
  document.getElementById('giro-c30-val').textContent  = custoUnit>0 ? fmt(c30.valor) : '—';

  const pontoRep = prazo > 0 ? vendasDia * prazo : 0;
  document.getElementById('giro-ponto-rep').textContent = fmtN(pontoRep);

  const diasAtePonto = prazo > 0 ? Math.max(Math.floor((estoqueAtual - pontoRep) / vendasDia), 0) : null;
  const elPontoDias  = document.getElementById('giro-ponto-dias');
  const elPontoLabel = document.getElementById('giro-ponto-label');
  const elPontoMsg   = document.getElementById('giro-ponto-msg');

  if(prazo > 0){
    if(estoqueAtual <= pontoRep){
      elPontoDias.textContent = '0';
      elPontoDias.style.color = '#f87171';
      elPontoLabel.textContent = 'Peça AGORA!';
      elPontoMsg.textContent = `Seu estoque (${fmtN(estoqueAtual)} unid.) já está no ponto de reposição ou abaixo. Se pedir hoje, o novo lote chega em ${prazo} dias — quando você terá aproximadamente ${fmtN(vendasDia*prazo)} unidades a menos.`;
    }else{
      elPontoDias.textContent = diasAtePonto;
      elPontoDias.style.color = diasAtePonto <= 5 ? '#f87171' : '#c4b5fd';
      elPontoLabel.textContent = 'dias a partir de hoje';
      elPontoMsg.textContent = `Quando seu estoque chegar a ${fmtN(pontoRep)} unidades, faça o pedido. O novo lote chegará exatamente quando você precisar, sem ficar em falta.`;
    }
  }else{
    elPontoDias.textContent = '—';
    elPontoLabel.textContent = 'preencha os dias do lote';
    elPontoMsg.textContent = 'Informe quantos dias o fornecedor demora para entregar para calcular o ponto de reposição.';
  }
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
  const todos=JSON.parse(localStorage.getItem('realecom_prods')||'[]');

  const agora=Date.now();
  const limite30=agora-(30*24*60*60*1000);
  const prodsMes=todos.filter(p=>{
    const ts=typeof p.id==='number'?p.id:parseInt(p.id);
    return ts>=limite30;
  });

  const qualTotal=document.getElementById('qual-total');
  if(qualTotal)qualTotal.textContent=prodsMes.length;

  // Usa precoML_margem para produtos novos, fallback para campo margem antigo
  const getMargem=p=>p.precoML>0&&p.precoML_margem!==undefined?p.precoML_margem:parseFloat(p.margem||0);
  const roi160=prodsMes.filter(p=>getMargem(p)>=10&&getMargem(p)<15).length;
  const roi180=prodsMes.filter(p=>getMargem(p)>=15&&getMargem(p)<20).length;
  const roi200=prodsMes.filter(p=>getMargem(p)>=20).length;

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
  atualizarGrafico('semana',prodsSemana,metaSemana,314);
  atualizarGrafico('quinzena',prodsQuinzena,metaQuinzena,314);
  atualizarGrafico('mes',prodsMes,metaMes,314);
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
function calcDevolucao(){
  if(!lastCalc||lastCalc.payout<=0)return;
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
