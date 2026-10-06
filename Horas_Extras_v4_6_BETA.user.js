// ==UserScript==
// @name         Horas Extras - Lançamento e Consulta
// @namespace    https://servicosead.praiagrande.sp.gov.br/
// @version      4.6.0-beta.18
// @description  HE variável até 4h, consulta preventiva de datas e relatório exportável — beta para testes
// @match        https://servicosead.praiagrande.sp.gov.br/folha/CadastroHoras.aspx*
// @match        https://servicosead.praiagrande.sp.gov.br/folha/ConsultaRegistro.aspx*
// @grant        GM_xmlhttpRequest
// @connect      brasilapi.com.br
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // Immutable event keys avoid read/modify/write races between tabs.
    function escopoOperacoes(){return window.__HEL_SIMULACAO__===true?'sim':'real';}
    function novoIdOperacao(){return crypto.randomUUID();}
    function prefixoEventosHE(){return 'pg_he_exclusao_evento_v47::'+escopoOperacoes()+'::';}
    function salvarEventoExclusao(evento){
        const e={...evento,id:evento.id||novoIdOperacao()},key=prefixoEventosHE()+e.id;
        const json=JSON.stringify(e);localStorage.setItem(key,json);
        if(localStorage.getItem(key)!==json)throw Error('Não foi possível confirmar o histórico salvo');
        return e;
    }
    function lerHistoricoExclusoes(){
        avisosHistoricoHE=[];
        let legado=[];try{legado=JSON.parse(localStorage.getItem('pg_he_exclusoes_confirmadas_v46')||'[]');if(!Array.isArray(legado))throw Error('Formato inválido');}catch(e){avisosHistoricoHE.push({chave:'pg_he_exclusoes_confirmadas_v46',erro:e.message});}
        const mapa=new Map();
        if(Array.isArray(legado))for(const e of legado){if(!!e.simulacao===(escopoOperacoes()==='sim'))mapa.set(e.id||JSON.stringify(e),e);}
        const prefixo=prefixoEventosHE();
        for(const key of Object.keys(localStorage).filter(k=>k.startsWith(prefixo))){try{const e=JSON.parse(localStorage.getItem(key));if(!e?.id||!e.registro)throw Error('Evento inválido');mapa.set(e.id,e);}catch(e){avisosHistoricoHE.push({chave:key,erro:e.message});}}
        return [...mapa.values()].sort((a,b)=>String(a.excluidoEm).localeCompare(String(b.excluidoEm)));
    }
    function chaveOperacaoHE(rf,data){return 'pg_he_inclusao_pendente_v47::'+escopoOperacoes()+'::'+String(rf).replace(/^0+(?=\d)/,'')+'::'+data;}
    function operacaoInclusaoValidaHE(op){
        if(!op||typeof op.id!=='string'||!op.id||!/^\d{1,6}$/.test(String(op.rf))||typeof op.nome!=='string'||!op.nome.trim()||!op.periodo||typeof op.periodo.nome!=='string'||!op.periodo.nome.trim()||!/^\d{4}$/.test(String(op.periodo.ano)))return false;
        const a=typeof op.data==='string'&&op.data.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);if(!a)return false;const dt=new Date(Number(a[3]),Number(a[2])-1,Number(a[1]),12);if(dt.getFullYear()!==Number(a[3])||dt.getMonth()!==Number(a[2])-1||dt.getDate()!==Number(a[1]))return false;
        return op.linha?.data===op.data&&['entrada','saidaAl','retorno','saida'].every(k=>typeof op.linha[k]==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(op.linha[k]))&&[op.seg50,op.seg100].every(v=>Number.isFinite(v)&&v>=0)&&op.seg50+op.seg100>0&&op.seg50+op.seg100<=14400;
    }
    function lerOperacaoHE(rf,data){
        const raw=localStorage.getItem(chaveOperacaoHE(rf,data));if(!raw)return null;
        const op=JSON.parse(raw);if(!operacaoInclusaoValidaHE(op)||op.data!==data||String(op.rf).replace(/^0+(?=\d)/,'')!==String(rf).replace(/^0+(?=\d)/,''))throw Error('Registro de inclusão pendente inválido');return op;
    }
    function registrarOperacaoHE(info,periodo,linha,seg50,seg100,apenasMigracao=false){
        if(!apenasMigracao&&erroMigracaoHE(info.rf))throw Error(erroMigracaoHE(info.rf));
        if(lerOperacaoHE(info.rf,linha.data))throw Error('Há uma inclusão pendente de confirmação para este RF e dia. Verifique as pendências antes de enviar.');
        const op={id:novoIdOperacao(),rf:info.rf,nome:info.nome,periodo:{...periodo},data:linha.data,linha:{...linha},seg50,seg100,enviadoEm:new Date().toISOString(),estado:'pendente'};
        if(!operacaoInclusaoValidaHE(op))throw Error('Os dados da inclusão pendente são inválidos. Nenhum envio será feito.');
        const key=chaveOperacaoHE(info.rf,linha.data),json=JSON.stringify(op);localStorage.setItem(key,json);
        if(localStorage.getItem(key)!==json)throw Error('O bloqueio da inclusão não pôde ser salvo. Nenhum envio será feito.');return op;
    }
    function concluirOperacaoHE(op,motivo){
        const atual=lerOperacaoHE(op.rf,op.data);if(!atual||atual.id!==op.id)return;
        const key='pg_he_inclusao_resolvida_v47::'+escopoOperacoes()+'::'+op.id;
        localStorage.setItem(key,JSON.stringify({...op,estado:motivo,resolvidoEm:new Date().toISOString()}));
        localStorage.removeItem(chaveOperacaoHE(op.rf,op.data));
    }
    function listarOperacoesHE(rf){
        const prefixo='pg_he_inclusao_pendente_v47::'+escopoOperacoes()+'::'+String(rf).replace(/^0+(?=\d)/,'')+'::';
        return Object.keys(localStorage).filter(k=>k.startsWith(prefixo)).map(k=>{const op=JSON.parse(localStorage.getItem(k));if(!operacaoInclusaoValidaHE(op)||k!==chaveOperacaoHE(rf,op.data))throw Error('Registro de pendência inválido');return op;});
    }
    let errosMigracaoHE=[],avisosHistoricoHE=[];
    const prefixoRecuperacaoHE=()=> 'pg_he_recuperacao_rascunho_v48::'+escopoOperacoes()+'::';
    function listarRecuperacoesHE(rf=null){
        const n=rf===null?null:String(rf).replace(/^0+(?=\d)/,'');
        return Object.keys(localStorage).filter(k=>k.startsWith(prefixoRecuperacaoHE())).map(k=>{const b=JSON.parse(localStorage.getItem(k));if(!b?.id||!b.chave||typeof b.conteudo!=='string'||!['pendente','revisado-manualmente'].includes(b.estado))throw Error('Dados de recuperação inválidos');return b;}).filter(b=>b.estado==='pendente'&&(n===null||!b.rf||b.rf===n));
    }
    function preservarRascunhoDanificadoHE(key,erro){
        const destino=prefixoRecuperacaoHE()+encodeURIComponent(key),anterior=localStorage.getItem(destino);
        if(anterior){const b=JSON.parse(anterior);if(b.estado==='pendente')return b;}
        const m=key.slice('pg_he_lote_v40_draft::'.length).match(/^(\d{6})(?=:)/);
        const b={id:novoIdOperacao(),chave:key,rf:m?m[1].replace(/^0+(?=\d)/,''):null,conteudo:localStorage.getItem(key)||'',erro,estado:'pendente',preservadoEm:new Date().toISOString()};
        const raw=JSON.stringify(b);localStorage.setItem(destino,raw);if(localStorage.getItem(destino)!==raw)throw Error('Não foi possível preservar o rascunho danificado');return b;
    }
    function protegerRascunhoHE(key){
        const raw=localStorage.getItem(key);
        if(raw){try{const d=JSON.parse(raw);if(!d||typeof d!=='object'||Array.isArray(d)||!Number.isInteger(d.versao)||!Array.isArray(d.linhas)||typeof d.servidor!=='string')throw Error('Rascunho inválido');}catch(e){preservarRascunhoDanificadoHE(key,e.message);}}
        return listarRecuperacoesHE().some(b=>b.chave===key)?'Rascunho antigo preservado para revisão. Ele não será sobrescrito nem removido.':'';
    }
    function concluirRecuperacaoHE(b){
        const key=prefixoRecuperacaoHE()+encodeURIComponent(b.chave),atual=JSON.parse(localStorage.getItem(key)||'null');if(!atual||atual.id!==b.id||atual.estado!=='pendente')throw Error('Os dados de recuperação mudaram; confira novamente');
        // Only explicit review may remove the original; preserved content stays in the journal.
        if(localStorage.getItem(b.chave)===b.conteudo)localStorage.removeItem(b.chave);
        localStorage.setItem(key,JSON.stringify({...atual,estado:'revisado-manualmente',revisadoEm:new Date().toISOString()}));
        migrarBloqueiosAntigosHE();
    }
    function erroMigracaoHE(rf){
        const n=String(rf||'').replace(/^0+(?=\d)/,'');
        return errosMigracaoHE.some(e=>!e.rf||e.rf===n)||listarRecuperacoesHE(rf).length?'Há rascunhos antigos danificados. O envio permanece bloqueado até conferir e resolver essas pendências.':'';
    }
    async function executarOperacaoExclusivaHE(acao){
        if(!navigator.locks?.request)throw Error('Este navegador não oferece a proteção entre abas necessária. Nenhuma operação foi enviada.');
        return navigator.locks.request('pg_he_operacoes_v48::'+escopoOperacoes(),{mode:'exclusive',ifAvailable:true},lock=>{
            if(!lock)throw Error('Há uma operação de horas extras em outra aba. Aguarde ela terminar e confira os dados antes de tentar novamente.');
            return acao();
        });
    }
    function migrarBloqueiosAntigosHE(){
        errosMigracaoHE=[];
        for(const key of Object.keys(localStorage).filter(k=>k.startsWith('pg_he_lote_v40_draft::'))){
            try{
            const d=JSON.parse(localStorage.getItem(key));
            if(!d||typeof d!=='object'||Array.isArray(d)||!Number.isInteger(d.versao)||!Array.isArray(d.linhas)||typeof d.servidor!=='string')throw Error('Rascunho inválido');
            if(d.versao!==46){if(Array.isArray(d.linhas)&&d.linhas.some(l=>l.incerto))throw Error('Versão da pendência não reconhecida');continue;}
            if(!Array.isArray(d.linhas))throw Error('Lista do rascunho inválida');
            const m=String(d.servidor||'').trim().match(/^(\d{6})\s+(.+)$/);if(!m){if(d.linhas.some(l=>l.incerto))throw Error('Servidor da pendência inválido');continue;}
            for(const l of d.linhas.filter(l=>l.incerto)){
                const marker='pg_he_migracao_pendente_v47::'+escopoOperacoes()+'::'+encodeURIComponent(key+'|'+d.salvoEm+'|'+l.data);
                if(localStorage.getItem(marker))continue;
                if(!lerOperacaoHE(m[1],l.data)){
                    const linha={...l};
                    if(l.saidaAl!==l.retorno){const min=v=>{const a=String(v).split(':').map(Number);return a[0]*60+a[1];},t=min(l.retorno)-(min(l.saidaAl)-min(l.entrada));linha.entrada=String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0');linha.saidaAl=l.retorno;}
                    registrarOperacaoHE({rf:m[1],nome:m[2]},{nome:d.periodoMes,ano:d.periodoAno},linha,Number(l.seg50||0),Number(l.seg100||0),true);
                }
                localStorage.setItem(marker,'1');
            }
            }catch(e){const m=key.slice('pg_he_lote_v40_draft::'.length).match(/^(\d{6})(?=:)/);errosMigracaoHE.push({key,rf:m?m[1].replace(/^0+(?=\d)/,''):null,erro:e.message});preservarRascunhoDanificadoHE(key,e.message);}
        }
        return errosMigracaoHE;
    }

    const prefixoExclusoesPendentesHE=()=> 'pg_he_exclusao_pendente_v48::'+escopoOperacoes()+'::';
    function chaveExclusaoHE(rf,data){return prefixoExclusoesPendentesHE()+String(rf).replace(/^0+(?=\d)/,'')+'::'+data;}
    function listarExclusoesPendentesHE(rf){
        const prefixo=prefixoExclusoesPendentesHE()+String(rf).replace(/^0+(?=\d)/,'')+'::';
        return Object.keys(localStorage).filter(k=>k.startsWith(prefixo)).map(k=>{const op=JSON.parse(localStorage.getItem(k));if(!op?.id||!op.data||!op.periodo?.nome||!op.periodo?.ano||!op.registro)throw Error('Pendência de exclusão inválida');return op;});
    }
    function registrarExclusaoHE(info,p,r){
        if(listarExclusoesPendentesHE(info.rf).some(o=>o.data===r.data))throw Error('Essa exclusão ainda precisa ser conferida. Verifique as exclusões pendentes; nenhum novo pedido foi enviado.');
        const op={id:novoIdOperacao(),rf:info.rf,nome:info.nome||r.nome,periodo:{...p},data:r.data,registro:{...r,rf:r.rf||r.registro||info.rf,retorno:r.retorno||r.retornoAl},enviadoEm:new Date().toISOString()};
        const key=chaveExclusaoHE(op.rf,op.data),raw=JSON.stringify(op);localStorage.setItem(key,raw);if(localStorage.getItem(key)!==raw)throw Error('Não foi possível preservar a exclusão. Nenhum pedido foi enviado.');return op;
    }

    let avisoOperacaoTimerHE, avisoOperacaoTipoHE='', avisoOperacaoQtdHE=0, avisoOperacaoGrupoHE='';
    const avisoOperacaoDiasHE=new Map();
    function notificarOperacaoHE(tipo,data,detalhes={}) {
        try {
            let box=document.getElementById('helAvisoOperacao');
            if(!box){
                const css=document.createElement('style');
                css.textContent='#helAvisoOperacao{position:fixed;right:20px;z-index:20000;width:max-content;max-width:min(640px,calc(100vw - 24px));box-sizing:border-box;background:#fff;border:1px solid #d7dee4;border-left:4px solid #258044;border-radius:4px;box-shadow:0 4px 18px #16304b26;padding:14px 12px 14px 16px;display:flex;align-items:center;gap:14px;font:14px/1.5 Arial,Helvetica,sans-serif;color:#216c3b}#helAvisoOperacao[hidden]{display:none}#helAvisoOperacao[data-tipo="exclusao"]{border-left-color:#b33232;color:#a32828}#helAvisoOperacao button{flex:none;border:0;background:transparent;color:inherit;font:20px Arial;cursor:pointer;padding:0 5px}#helAvisoOperacao span{overflow-wrap:anywhere}@media(max-width:650px){#helAvisoOperacao{right:12px;max-width:calc(100vw - 24px)}}@media print{#helAvisoOperacao{display:none!important}}';
                document.head.appendChild(css);
                box=document.createElement('div');box.id='helAvisoOperacao';box.hidden=true;
                box.innerHTML='<span role="status" aria-live="polite" aria-atomic="true"></span><button type="button" aria-label="Fechar notificação">×</button>';
                box.querySelector('button').onclick=()=>{box.hidden=true;clearTimeout(avisoOperacaoTimerHE);avisoOperacaoQtdHE=0;};
                document.body.appendChild(box);
            }
            const grupo=detalhes.grupo||'';
            const continuar=!box.hidden&&avisoOperacaoTipoHE===tipo&&avisoOperacaoGrupoHE===grupo;
            if(!continuar)avisoOperacaoDiasHE.clear();
            avisoOperacaoQtdHE=continuar?avisoOperacaoQtdHE+1:1;
            avisoOperacaoGrupoHE=grupo;
            avisoOperacaoTipoHE=tipo;box.dataset.tipo=tipo;
            const excluida=tipo==='exclusao';
            let texto;
            {
                avisoOperacaoDiasHE.set(data,Number(detalhes.segundos)||0);
                const qtd=avisoOperacaoDiasHE.size;
                const totalMin=Math.round([...avisoOperacaoDiasHE.values()].reduce((s,v)=>s+v,0)/60);
                const horas=Math.floor(totalMin/60),minutos=totalMin%60;
                const duracao=[horas?horas+' '+(horas===1?'hora':'horas'):'',minutos?minutos+' '+(minutos===1?'minuto':'minutos'):''].filter(Boolean).join(' e ')||'0 horas';
                texto='Horas extras '+(excluida?'excluídas':'cadastradas')+' para '+(detalhes.nome||'o servidor')+' em '+qtd+' '+(qtd===1?'dia':'dias')+', totalizando '+duracao+'.';
            }
            box.querySelector('span').textContent=texto;
            const barra=document.querySelector('.hel-footer');
            box.style.bottom=(barra?Math.max(0,innerHeight-barra.getBoundingClientRect().top)+12:16)+'px';
            box.hidden=false;clearTimeout(avisoOperacaoTimerHE);
            avisoOperacaoTimerHE=setTimeout(()=>{box.hidden=true;avisoOperacaoQtdHE=0;},6000);
        }catch{}
    }

    function concluirExclusaoHE(op,recuperada=false){
        const key=chaveExclusaoHE(op.rf,op.data),atual=JSON.parse(localStorage.getItem(key)||'null');if(!atual||atual.id!==op.id)throw Error('A pendência de exclusão mudou; confira novamente');
        salvarEventoExclusao({id:op.id,excluidoEm:new Date().toISOString(),rf:op.rf,periodo:op.periodo,registro:op.registro,simulacao:escopoOperacoes()==='sim',recuperadaPelaConsulta:recuperada});localStorage.removeItem(key);notificarOperacaoHE('exclusao',op.data,{nome:op.nome||op.registro.nome,grupo:JSON.stringify([op.rf,op.periodo.nome,op.periodo.ano]),segundos:['he50','he100'].reduce((s,k)=>{const [h,m]=String(op.registro[k]||'00:00').split(':').map(Number);return s+(Number.isFinite(h)&&Number.isFinite(m)?h*3600+m*60:0);},0)});
    }
    function liberarExclusaoManualHE(op){
        const key=chaveExclusaoHE(op.rf,op.data),atual=JSON.parse(localStorage.getItem(key)||'null');if(!atual||atual.id!==op.id)throw Error('A pendência mudou; confira novamente');
        localStorage.setItem('pg_he_exclusao_revisada_v48::'+escopoOperacoes()+'::'+op.id,JSON.stringify({...op,revisadaEm:new Date().toISOString(),estado:'liberada-manualmente'}));localStorage.removeItem(key);
    }
    function criarRecuperacaoExclusoesHE(container,rfAtual,consultar,avisar,ocupado){
        const box=document.createElement('details');box.className='hel-delete-recovery';box.style.cssText='margin:8px 0;padding:8px 10px;background:#fff7e3;border-left:3px solid #a76a00;font:12px Arial';container.appendChild(box);let ativo=false;const conferidos=new Map();
        const norm=v=>String(v||'').trim().replace(/^0+(?=\d)/,'');
        const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
        const assinatura=r=>JSON.stringify([r?.data,r?.nome,r?.entrada,r?.saidaAl,r?.retorno||r?.retornoAl,r?.saida,r?.he50,r?.he100,r?.adNoturno||'00:00',r?.usuario]);
        function render(){
            let ops=[];try{if(rfAtual())ops=listarExclusoesPendentesHE(rfAtual());}catch(e){box.hidden=false;box.textContent='Não foi possível ler as exclusões pendentes: '+e.message;return;}
            box.hidden=!ops.length;if(box.hidden)return;
            box.innerHTML='<summary>Exclusões pendentes de confirmação ('+ops.length+')</summary><p>Esses dias não serão enviados ou excluídos novamente até conferir o resultado.</p><button type="button" class="hel-btn hel-delete-check">Verificar exclusões pendentes</button>'+ops.map(o=>'<div style="padding:6px 0">'+esc(o.data)+' · Folha '+esc(o.periodo.nome+'/'+o.periodo.ano)+(conferidos.has(o.id)?' · Ainda aparece <button type="button" class="hel-btn hel-delete-review" data-id="'+esc(o.id)+'">Revisão manual</button>':'')+'</div>').join('');
            box.querySelectorAll('button').forEach(b=>b.disabled=ativo||ocupado());box.querySelector('.hel-delete-check').onclick=()=>executar();box.querySelectorAll('.hel-delete-review').forEach(b=>b.onclick=()=>executar(b.dataset.id));
        }
        async function executar(id=null){
            if(ativo||ocupado())return;ativo=true;render();const rf=norm(rfAtual());
            try{await executarOperacaoExclusivaHE(async()=>{
                const ops=listarExclusoesPendentesHE(rf).filter(o=>!id||o.id===id);let confirmadas=0;
                for(const op of ops){
                    const mapa=await consultar(op);if(norm(rfAtual())!==rf)throw Error('O RF mudou durante a conferência. Confira as pendências novamente.');const atual=mapa.get(op.data);
                    if(!atual){concluirExclusaoHE(op,true);conferidos.delete(op.id);confirmadas++;continue;}
                    if(id){
                        const anterior=conferidos.get(id);if(!anterior||Date.now()-anterior.em>300000||assinatura(atual)!==anterior.assinatura)throw Error('O registro mudou ou a conferência venceu. Verifique as exclusões pendentes novamente.');
                        const horario=atual.entrada+'–'+atual.saidaAl+' / '+(atual.retorno||atual.retornoAl)+'–'+atual.saida;
                        if(confirm('Liberar exclusão sem confirmação?\n\n'+op.rf+' — '+op.nome+'\n'+op.data+' · Folha '+op.periodo.nome+'/'+op.periodo.ano+'\nRegistro encontrado: '+horario+'\nHE 50%: '+atual.he50+' · HE 100%: '+atual.he100+'\n\nO dia ainda aparece, mas um pedido anterior pode terminar depois. Confirme somente se você verificou no sistema que ele não está em processamento. Se houver dúvida, cancele.\n\nLiberar apenas o bloqueio? Nenhum pedido de exclusão será enviado.')){liberarExclusaoManualHE(op);conferidos.delete(id);}
                    }else conferidos.set(op.id,{em:Date.now(),assinatura:assinatura(atual)});
                }
                avisar('info',confirmadas+' exclusão(ões) conferida(s) pela ausência do dia. As demais continuam pendentes, salvo revisão manual explícita.');
            });}catch(e){avisar('warning',e.message);}finally{ativo=false;render();}
        }
        window.addEventListener('storage',e=>{if(e.key===null||e.key?.startsWith(prefixoExclusoesPendentesHE())){conferidos.clear();render();}});container.addEventListener('change',()=>{if(!ativo){conferidos.clear();render();}});render();return render;
    }

    const paginaAtual = (location.pathname || '').toLowerCase();

    let carregamentoConsulta;
    const consultaPagina=paginaAtual.endsWith('/consultaregistro.aspx');
    if(consultaPagina){
        const instalar=()=>{if(!document.documentElement)return;document.documentElement.classList.add('helq-loading');const css=document.createElement('style');css.textContent='html.helq-loading #form1{visibility:hidden}html.helq-loading body:before{content:"Carregando consulta…";display:block;padding:24px;font:14px Arial;color:#334155}';document.documentElement.appendChild(css);};
        if(document.documentElement)instalar();else {const o=new MutationObserver(()=>{if(document.documentElement){o.disconnect();instalar();}});o.observe(document,{childList:true});}
        carregamentoConsulta=setTimeout(()=>document.documentElement?.classList.remove('helq-loading'),5000);
    }
    const iniciar=()=>{try {if(consultaPagina)initConsulta();else if(paginaAtual.endsWith('/cadastrohoras.aspx'))initCadastro();}finally {clearTimeout(carregamentoConsulta);document.documentElement?.classList.remove('helq-loading');}};
    if(document.readyState==='loading'&&window.__HEL_SIMULACAO__!==true)document.addEventListener('DOMContentLoaded',iniciar,{once:true});else iniciar();
    return;

    function duracaoRetornadaValida(v) {
        return typeof v === 'string' && /^\d{1,3}:\d{2}(?::\d{2})?$/.test(v) && Number(v.split(':')[1]) < 60 && (v.split(':').length === 2 || Number(v.split(':')[2]) < 60);
    }
    function initCadastro() {
        if (document.getElementById('hel-app')) return;

    const MESES = [
        'Janeiro', 'Fevereiro', 'Março', 'Abril',
        'Maio', 'Junho', 'Julho', 'Agosto',
        'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];

    const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const HE_LIMITE_SEGUNDOS = 4 * 60 * 60;
    const JORNADA_NORMAL_MINUTOS = 240;
    const CARGA_SISTEMA = '04:00';
    const MODO_SIMULACAO = window.__HEL_SIMULACAO__ === true;
    const DRAFT_PREFIX = 'pg_he_lote_v40_draft::';
    const DRAFT_INDEX_KEY = 'pg_he_lote_v40_draft_index';
    const LEGACY_DRAFT_KEY = 'pg_he_lote_v3_draft';

    const form = document.getElementById('form1');
    const painelOriginal = document.getElementById('Panel1');
    const txtServidor = document.getElementById('txtServidor');
    const txtReg = document.getElementById('txtReg');
    const sistemaMes = document.getElementById('DropDownList1');
    const sistemaAno = document.getElementById('anoPeriodo');
    const sistemaCarga = document.getElementById('DropDownList2');

    if (!form || !painelOriginal || !txtServidor || !txtReg || !sistemaMes || !sistemaAno || !sistemaCarga) {
        console.error('[HE Lote] Formulário original não encontrado.');
        return;
    }

    // Para atendentes, a carga funcional permanece fixa em 04:00.
    // A compatibilidade com o sistema é feita pelos horários enviados,
    // nunca alterando a carga horária para 06:00/08:00/12:00.

    const toolkitAtual = document.getElementById('ToolkitScriptManager1_HiddenField')?.value || '';
    let processando = false;
    let cancelarSolicitado = false;
    let auditoria = [];
    let auditoriaMeta = null;
    let auditoriaEhAnterior = false;
    let ultimoSnapshotServidor = '';
    let timerServidor = null;
    let consultaContexto = '';
    let contextoObservado = null;
    let registrosExistentes = new Map();
    let consultaConfirmada = false;
    let consultando = false;
    let timerConsulta = null;
    let consultaPromessa = null;
    const cacheCalendario = new Map();

    // ---------------------------------------------------------------------
    // Estilo
    // ---------------------------------------------------------------------
    const style = document.createElement('style');
    style.textContent = `
        :root {
            --hel-blue: #2f5d86;
            --hel-blue-dark: #244866;
            --hel-blue-soft: #eef4f9;
            --hel-green: #2f6f45;
            --hel-green-soft: #edf7f0;
            --hel-amber: #9a6700;
            --hel-amber-soft: #fff7e3;
            --hel-red: #9b2c2c;
            --hel-red-soft: #fff0f0;
            --hel-gray-050: #fbfbfb;
            --hel-gray-100: #f4f4f4;
            --hel-gray-200: #e4e4e4;
            --hel-gray-300: #c9c9c9;
            --hel-gray-500: #707070;
            --hel-gray-700: #333;
        }

        #hel-app {
            max-width: 1180px;
            margin: 16px auto 40px;
            font-family: Arial, Helvetica, sans-serif;
            font-size: 13px;
            color: #222;
        }
        #hel-app * { box-sizing: border-box; }

        .hel-page-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
            margin-bottom: 15px;
            padding: 10px 0 12px 12px;
            border-bottom: 1px solid #aeb7bf;
            border-left: 5px solid var(--hel-blue);
        }
        .hel-sim-banner {
            display: inline-block;
            margin-top: 8px;
            padding: 6px 9px;
            border: 1px solid #d5b46c;
            background: #fff7e3;
            color: #714b11;
            font-size: 11px;
            font-weight: 700;
        }
        /* Valor técnico mantido somente internamente para o POST.
           Não é exibido ao usuário para evitar confusão com a HE devida. */
        .hel-carga-tecnica,
        .hel-carga-tecnica-col {
            display: none !important;
        }
        .hel-page-header h1 {
            margin: 0;
            color: #222;
            font-size: 22px;
            font-weight: 700;
            letter-spacing: .1px;
        }
        .hel-page-header .hel-subtitle {
            margin-top: 3px;
            color: #666;
            font-size: 12px;
        }
        .hel-back {
            color: var(--hel-blue-dark);
            font-weight: 700;
            text-decoration: none;
            white-space: nowrap;
        }
        .hel-back:hover { text-decoration: underline; }

        .hel-section {
            margin-bottom: 14px;
            border: 1px solid #b9b9b9;
            background: #fff;
        }
        .hel-section-title {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 9px 12px;
            border-bottom: 1px solid #b9b9b9;
            background: #edf1f4;
            color: #283746;
            font-size: 14px;
            font-weight: 700;
        }
        .hel-section-title-note {
            color: #5b6770;
            font-size: 12px;
            font-weight: 400;
        }
        .hel-section-body { padding: 13px; }

        .hel-grid {
            display: grid;
            grid-template-columns: 2.4fr 140px 185px 220px 115px;
            gap: 11px;
            align-items: end;
        }
        .hel-field {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
        .hel-field label {
            color: #333;
            font-size: 12px;
            font-weight: 700;
        }
        #hel-app input,
        #hel-app select {
            height: 34px !important;
            border: 1px solid #949494 !important;
            border-radius: 2px !important;
            padding: 5px 7px !important;
            background: #fff;
            color: #222;
            font-family: Arial, Helvetica, sans-serif !important;
            font-size: 13px !important;
        }
        #hel-app input:focus,
        #hel-app select:focus {
            outline: 2px solid rgba(47,93,134,.18) !important;
            border-color: var(--hel-blue) !important;
        }
        #helServidorBox input { width: 100% !important; }
        #helRegistroBox input {
            width: 100% !important;
            background: #eee !important;
        }
        .hel-periodo-row {
            display: flex;
            gap: 5px;
        }
        .hel-periodo-row select:first-child { flex: 1; }
        .hel-periodo-row select:last-child { width: 78px; }
        .hel-carga {
            height: 34px;
            min-width: 105px;
            border: 1px solid #aaa;
            background: #eee;
            padding: 8px 6px;
            text-align: center;
            font-weight: 700;
            white-space: nowrap;
        }

        .hel-server-selected {
            display: none;
            margin-top: 11px;
            padding: 8px 10px;
            border-left: 4px solid var(--hel-blue);
            background: var(--hel-blue-soft);
            color: #24445e;
        }
        .hel-server-selected.visible { display: block; }
        .hel-server-selected.valid {
            border-left-color: var(--hel-green);
            background: var(--hel-green-soft);
            color: #245737;
        }
        .hel-server-selected.warning {
            border-left-color: var(--hel-amber);
            background: var(--hel-amber-soft);
            color: #6f4d08;
        }

        .hel-periodo-extra {
            display: grid;
            grid-template-columns: 2.4fr 140px 185px 220px 95px;
            gap: 8px 11px;
            margin-top: 10px;
            padding-top: 10px;
            border-top: 1px solid #ddd;
        }
        .hel-periodo-extra > label {
            grid-column: 4 / span 2;
            display: inline-flex;
            align-items: center;
            justify-self: start;
            gap: 7px;
            margin: 0;
            line-height: 1.25;
            cursor: pointer;
            user-select: none;
        }
        #helAvisoPeriodo,
        #helErroPeriodo {
            grid-column: 4 / -1;
            width: 100%;
        }
        .hel-periodo-extra input[type="checkbox"],
        .hel-modal-check input[type="checkbox"] {
            width: 14px !important;
            height: 14px !important;
            min-height: 0 !important;
            margin: 0 !important;
            padding: 0 !important;
            flex: 0 0 auto;
            vertical-align: middle;
        }
        #helAvisoPeriodo,
        #helErroPeriodo {
            display: none;
            margin-top: 8px;
            padding: 8px 10px;
        }
        #helAvisoPeriodo {
            border-left: 4px solid var(--hel-amber);
            background: var(--hel-amber-soft);
            color: #714b11;
        }
        #helErroPeriodo {
            border-left: 4px solid var(--hel-red);
            background: var(--hel-red-soft);
            color: #7d2020;
            font-weight: 700;
        }

        .hel-horarios {
            display: grid;
            grid-template-columns: repeat(4, 130px) auto;
            gap: 10px;
            align-items: end;
        }
        .hel-horarios input {
            width: 100% !important;
            text-align: center;
        }

        .hel-btn {
            min-height: 34px;
            border: 1px solid #858585;
            border-radius: 2px;
            background: #efefef;
            padding: 6px 12px;
            color: #222;
            cursor: pointer;
            font-weight: 700;
        }
        .hel-btn:hover { background: #dfdfdf; }
        .hel-btn-main {
            background: var(--hel-blue);
            border-color: var(--hel-blue-dark);
            color: #fff;
        }
        .hel-btn-main:hover { background: var(--hel-blue-dark); }
        .hel-btn-send {
            background: var(--hel-green);
            border-color: #285b3a;
            color: #fff;
        }
        .hel-btn-send:hover { background: #285f3b; }
        .hel-btn-danger {
            background: #fff;
            color: var(--hel-red);
            border-color: #b98e8e;
        }
        .hel-btn:disabled {
            opacity: .46;
            cursor: not-allowed;
        }

        .hel-draft {
            display: grid;
            grid-template-columns: 1fr auto;
            align-items: end;
            gap: 10px;
            margin-bottom: 12px;
            padding: 10px;
            border: 1px solid #c6c6c6;
            background: #f7f7f7;
        }
        .hel-draft.hidden { display: none; }
        .hel-draft-select {
            width: 100%;
            max-width: 620px;
            margin-top: 5px;
        }
        .hel-draft-actions {
            display: flex;
            gap: 6px;
            flex-wrap: wrap;
        }

        .hel-days-row {
            display: flex;
            gap: 8px;
        }
        #helDias { flex: 1; }
        .hel-quick-days {
            display: flex;
            align-items: center;
            gap: 6px;
            flex-wrap: wrap;
            margin-top: 8px;
        }
        .hel-quick-days-label {
            margin-right: 2px;
            color: #555;
            font-size: 11px;
            font-weight: 700;
        }
        .hel-btn-quick {
            min-height: 29px !important;
            padding: 4px 9px !important;
            border-color: #aab3ba !important;
            background: #f7f8f9 !important;
            color: #34424e !important;
            font-size: 11px !important;
        }
        .hel-btn-quick:hover {
            background: #edf1f4 !important;
        }
        .hel-note {
            margin-top: 6px;
            color: #666;
            font-size: 12px;
        }
        .hel-input-notices {
            display: none;
            margin-top: 8px;
            padding: 8px 10px;
            border-left: 4px solid var(--hel-amber);
            background: var(--hel-amber-soft);
            color: #6f4d08;
        }
        .hel-input-notices.visible { display: block; }
        .hel-input-notices div + div { margin-top: 3px; }

        .hel-table-wrap {
            margin-top: 13px;
            overflow-x: auto;
        }
        .hel-table {
            width: 100%;
            border-collapse: collapse;
        }
        .hel-table th {
            padding: 7px 5px;
            border: 1px solid #b9b9b9;
            background: #e8ecef;
            color: #37424b;
            font-size: 11px;
            white-space: nowrap;
        }
        .hel-table td {
            padding: 5px;
            border: 1px solid #ccc;
            text-align: center;
        }
        .hel-table tr:nth-child(even) td { background: #fafafa; }
        .hel-table input {
            height: 30px !important;
            text-align: center;
        }
        .hel-data-combined {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 5px;
            min-width: 155px;
        }
        .hel-data { width: 105px; }
        .hel-dia-semana {
            min-width: 35px;
            color: #626262;
            font-size: 12px;
            font-weight: 700;
            text-align: left;
        }
        .hel-dia-semana.weekend { color: #8a5a00; }
        .hel-hora { width: 68px; }
        .hel-he {
            min-width: 58px;
            font-weight: 700;
        }
        .hel-status {
            min-width: 190px;
            font-size: 12px;
            font-weight: 700;
        }
        .hel-ok { color: var(--hel-green); }
        .hel-warning { color: var(--hel-amber); }
        .hel-error { color: var(--hel-red); }
        .hel-processing { color: var(--hel-blue); }
        .hel-remove {
            border: 0;
            background: transparent;
            color: var(--hel-red);
            cursor: pointer;
            font-size: 17px;
        }
        .hel-duplicate td { background: #fff0f0 !important; }
        .hel-weekend-invalid td { background: var(--hel-red-soft) !important; }
        .hel-weekend-invalid td:first-child { box-shadow: inset 4px 0 0 var(--hel-red); }
        .hel-horario-diferente td:first-child { border-left: 4px solid #c08b2d; }
        .hel-future td:first-child { box-shadow: inset 3px 0 0 #c08b2d; }
        .hel-uncertain td { background: #fff7e3 !important; }

        .hel-actions {
            display: flex;
            justify-content: space-between;
            gap: 10px;
            margin-top: 13px;
        }
        .hel-actions > div {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }
        .hel-conference-state {
            margin-top: 10px;
            padding: 7px 9px;
            border-left: 4px solid #aaa;
            background: #f5f5f5;
            color: #555;
            font-weight: 700;
        }
        .hel-conference-state.ready {
            border-left-color: var(--hel-green);
            background: var(--hel-green-soft);
            color: #245737;
        }
        .hel-conference-state.blocked {
            border-left-color: var(--hel-amber);
            background: var(--hel-amber-soft);
            color: #6f4d08;
        }
        .hel-conference-state.error {
            border-left-color: var(--hel-red);
            background: var(--hel-red-soft);
            color: #7d2020;
        }

        #helMensagem {
            display: none;
            margin-top: 11px;
            padding: 8px 10px;
            border: 1px solid #bbb;
        }
        #helMensagem.info {
            display: block;
            background: #f5f5f5;
        }
        #helMensagem.success {
            display: block;
            background: var(--hel-green-soft);
            border-color: #91b698;
            color: #235c30;
        }
        #helMensagem.warning {
            display: block;
            background: var(--hel-amber-soft);
            border-color: #d5b46c;
            color: #714b11;
        }
        #helMensagem.error {
            display: block;
            background: var(--hel-red-soft);
            border-color: #d29b9b;
            color: #8b1d1d;
        }

        .hel-summary-human {
            margin-bottom: 10px;
            padding: 10px 12px;
            border-left: 4px solid var(--hel-blue);
            background: var(--hel-blue-soft);
            color: #24445e;
            font-size: 15px;
            font-weight: 700;
        }
        .hel-summary-table,
        .hel-audit-table {
            width: 100%;
            border-collapse: collapse;
        }
        .hel-summary-table td,
        .hel-audit-table th,
        .hel-audit-table td {
            border: 1px solid #bbb;
            padding: 8px;
            text-align: center;
        }
        .hel-summary-table .label,
        .hel-audit-table th {
            background: #eee;
            color: #555;
            font-size: 11px;
        }
        .hel-summary-table .value {
            font-size: 19px;
            font-weight: 700;
        }
        .hel-summary-table .total { background: #edf2f7; }
        .hel-summary-table .included { background: var(--hel-green-soft); }
        .hel-audit-meta {
            margin-bottom: 10px;
            padding: 9px 10px;
            border-left: 4px solid var(--hel-blue);
            background: #f4f7f9;
            color: #34495a;
        }

        .hel-progress {
            display: none;
            margin-top: 11px;
        }
        .hel-progress.visible { display: block; }
        .hel-progress-track {
            height: 10px;
            border: 1px solid #aaa;
            background: #eee;
        }
        #helProgressBar {
            height: 100%;
            width: 0%;
            background: var(--hel-blue);
            transition: width .15s linear;
        }
        #helProgressText {
            margin-top: 4px;
            text-align: center;
            color: #555;
            font-size: 12px;
        }

        .hel-modal-overlay {
            display: none;
            position: fixed;
            z-index: 999999;
            inset: 0;
            padding: 25px;
            overflow-y: auto;
            background: rgba(0,0,0,.45);
        }
        .hel-modal-overlay.visible { display: block; }
        .hel-modal {
            max-width: 780px;
            margin: 30px auto;
            border: 1px solid #777;
            background: #fff;
            box-shadow: 0 5px 20px rgba(0,0,0,.28);
        }
        .hel-modal-head {
            padding: 12px 14px;
            border-bottom: 1px solid #bbb;
            background: #e8ecef;
            color: #283746;
            font-size: 16px;
            font-weight: 700;
        }
        .hel-modal-body { padding: 14px; }
        .hel-modal-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px 15px;
        }
        .hel-modal-item {
            border-bottom: 1px solid #eee;
            padding: 5px 0;
        }
        .hel-modal-item span {
            display: block;
            color: #666;
            font-size: 11px;
        }
        .hel-modal-item strong { display: block; }
        .hel-modal-human {
            margin-top: 12px;
            padding: 9px 10px;
            border-left: 4px solid var(--hel-blue);
            background: var(--hel-blue-soft);
            color: #24445e;
            font-size: 14px;
            font-weight: 700;
        }
        .hel-modal-exception,
        .hel-modal-warning {
            margin-top: 10px;
            padding: 9px 10px;
            border-left: 4px solid var(--hel-amber);
            background: var(--hel-amber-soft);
            color: #714b11;
            font-weight: 700;
        }

        .hel-compat-summary {
            display: none;
            margin-top: 10px;
            border: 1px solid #dfc98d;
            border-left: 4px solid var(--hel-amber);
            background: #fffaf0;
            color: #4f421f;
        }
        .hel-compat-summary.visible { display: block; }
        .hel-compat-summary-head {
            display: flex;
            justify-content: space-between;
            gap: 12px;
            align-items: center;
            padding: 9px 11px;
            border-bottom: 1px solid #eadbb5;
            background: #fff5d9;
            color: #6d4c06;
            font-weight: 700;
        }
        .hel-compat-summary-count {
            white-space: nowrap;
            font-size: 11px;
            font-weight: 700;
        }
        .hel-compat-group {
            padding: 10px 11px;
        }
        .hel-compat-group + .hel-compat-group {
            border-top: 1px solid #eadfca;
        }
        .hel-compat-row {
            display: grid;
            grid-template-columns: 145px 1fr;
            gap: 8px;
            align-items: baseline;
            padding: 2px 0;
        }
        .hel-compat-label {
            color: #6d6250;
            font-size: 11px;
            font-weight: 700;
        }
        .hel-compat-value {
            color: #2f3438;
            font-family: Consolas, "Courier New", monospace;
            font-size: 12px;
        }
        .hel-compat-value.technical {
            font-weight: 700;
            color: #5d430a;
        }
        .hel-compat-dates {
            font-family: Arial, Helvetica, sans-serif;
            font-weight: 600;
        }
        .hel-compat-note {
            padding: 8px 11px;
            border-top: 1px solid #eadbb5;
            color: #6b5a30;
            font-size: 11px;
        }

        .hel-compat-details {
            margin: 0;
        }
        .hel-compat-details > summary {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            padding: 9px 11px;
            cursor: pointer;
            list-style: none;
            background: #fff5d9;
            color: #6d4c06;
            font-weight: 700;
        }
        .hel-compat-details > summary::-webkit-details-marker { display: none; }
        .hel-compat-details > summary::after {
            content: "Ver detalhes";
            color: #7b6532;
            font-size: 11px;
            font-weight: 600;
        }
        .hel-compat-details[open] > summary::after {
            content: "Ocultar detalhes";
        }

        .hel-final-count {
            margin-top: 11px;
            padding: 10px 12px;
            border-left: 4px solid var(--hel-blue);
            background: #f1f6fa;
            color: #23445f;
            font-size: 13px;
            font-weight: 700;
        }
        .hel-final-count .hel-count-secondary {
            display: block;
            margin-top: 3px;
            color: #5f6f7d;
            font-size: 11px;
            font-weight: 400;
        }

        .hel-tech-details {
            display: none;
            margin-top: 10px;
            border: 1px solid #c7cdd2;
            background: #fafbfc;
        }
        .hel-tech-details > summary {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            padding: 8px 10px;
            cursor: pointer;
            list-style: none;
            color: #34495e;
            font-weight: 700;
            background: #f1f3f5;
        }
        .hel-tech-details > summary::-webkit-details-marker { display: none; }
        .hel-tech-details > summary::after {
            content: "Expandir";
            color: #68737d;
            font-size: 11px;
            font-weight: 600;
        }
        .hel-tech-details[open] > summary::after {
            content: "Recolher";
        }
        .hel-tech-details-body {
            padding: 9px 10px 10px;
        }
        .hel-tech-note {
            color: #606a73;
            font-size: 11px;
            margin-bottom: 8px;
        }
        .hel-tech-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 11px;
        }
        .hel-tech-table th,
        .hel-tech-table td {
            border: 1px solid #d5d9dc;
            padding: 6px 7px;
            text-align: left;
            vertical-align: top;
        }
        .hel-tech-table th {
            background: #eef0f2;
            color: #495057;
        }
        .hel-tech-table .hel-tech-time {
            font-family: Consolas, "Courier New", monospace;
            white-space: nowrap;
        }
        .hel-tech-table .hel-tech-system {
            color: #6d4c06;
            font-weight: 700;
        }

        .hel-table tr.hel-dirty td {
            background: #fffaf0 !important;
        }
        .hel-table tr.hel-dirty .hel-status {
            color: var(--hel-amber);
            font-weight: 700;
        }
        .hel-modal-checks {
            margin-top: 11px;
        }
        .hel-modal-check {
            display: none;
            margin-top: 7px;
            padding: 8px 10px;
            border: 1px solid #d6bd84;
            background: #fffaf0;
            color: #67490f;
        }
        .hel-modal-check.visible { display: block; }
        .hel-modal-actions {
            display: flex;
            justify-content: flex-end;
            gap: 7px;
            padding: 12px 14px;
            border-top: 1px solid #bbb;
            background: #f7f7f7;
        }
        .hel-locked { opacity: .82; }

        @media(max-width: 900px) {
            .hel-grid,
            .hel-horarios,
            .hel-periodo-extra {
                grid-template-columns: 1fr 1fr;
            }
            .hel-periodo-extra > label,
            #helAvisoPeriodo,
            #helErroPeriodo {
                grid-column: 1 / -1;
            }
        }
        @media(max-width: 650px) {
            .hel-grid,
            .hel-horarios,
            .hel-periodo-extra,
            .hel-modal-grid {
                grid-template-columns: 1fr;
            }
            .hel-days-row,
            .hel-actions,
            .hel-page-header,
            .hel-draft {
                grid-template-columns: 1fr;
                flex-direction: column;
                align-items: stretch;
            }
        }
    `;
    document.head.appendChild(style);

    // ---------------------------------------------------------------------
    // Interface
    // ---------------------------------------------------------------------
    const tituloOriginal = [...document.querySelectorAll('.style6')]
        .find(el => /CADASTRO DE HORAS EXTRAS/i.test(el.textContent || ''));
    const voltarOriginal = document.getElementById('HyperLink1');
    const voltarHref = voltarOriginal?.getAttribute('href') || 'PrincipalDoUsuario.aspx';

    const app = document.createElement('div');
    app.id = 'hel-app';
    app.innerHTML = `
        <div class="hel-page-header">
            <div>
                <h1>Horas Extras</h1>

                ${MODO_SIMULACAO ? '<div class="hel-sim-banner">MODO SIMULAÇÃO · nenhum dado será enviado. O cálculo reproduz apenas a hipótese observada no sistema original.</div>' : ''}
            </div>
            <a class="hel-back" href="${voltarHref}">← Voltar</a>
        </div>

        <div id="helDraftBox" class="hel-draft hidden">
            <div>
                <strong>Rascunhos salvos neste navegador</strong>
                <div class="hel-note">Cada rascunho é separado por servidor e mês das horas.</div>
                <select id="helDraftSelect" class="hel-draft-select"></select>
            </div>
            <div class="hel-draft-actions">
                <button type="button" class="hel-btn" id="helRestaurarRascunho">Restaurar</button>
                <button type="button" class="hel-btn hel-btn-danger" id="helDescartarRascunho">Descartar</button>
            </div>
        </div>

        <div class="hel-section">
            <div class="hel-section-title">Dados do servidor e período</div>
            <div class="hel-section-body">
                <div class="hel-grid">
                    <div class="hel-field">
                        <label>Servidor</label>
                        <div id="helServidorBox"></div>
                    </div>
                    <div class="hel-field">
                        <label>Registro</label>
                        <div id="helRegistroBox"></div>
                    </div>
                    <div class="hel-field">
                        <label>Mês das horas</label>
                        <div class="hel-periodo-row">
                            <select id="helMesHoras">
                                ${MESES.map((nome, indice) => `<option value="${indice + 1}">${nome}</option>`).join('')}
                            </select>
                            <select id="helAnoHoras"></select>
                        </div>
                    </div>
                    <div class="hel-field">
                        <div class="hel-periodo-heading"><label class="hel-periodo-toggle" title="Marque para alterar o mês e o ano de lançamento abaixo"><input type="checkbox" id="helPeriodoDiferente" aria-label="Alterar período de lançamento" aria-controls="helPeriodoMes helPeriodoAno"> Alterar período de lançamento</label></div>
                        <div class="hel-periodo-row">
                            <select id="helPeriodoMes"></select>
                            <select id="helPeriodoAno"></select>
                        </div>
                    </div>
                    <div class="hel-field">
                        <label>HE permitida</label>
                        <div class="hel-carga" title="Carga normal: 04:00. HE calculada pelos horários, limitada a 04:00 por dia.">Até 04:00 / dia</div>
                    </div>
                </div>

                <div id="helServidorSelecionado" class="hel-server-selected"></div>
                <div class="hel-note"><details id="helRegraCalculo"><summary>Como é calculado</summary><div class="hel-calculo-info"><p>Somamos o tempo trabalhado antes e depois do almoço, sem contar o intervalo. Descontamos as <strong>4 horas da jornada normal</strong>; o restante são horas extras.</p><div class="hel-calculo-exemplo"><span>Exemplo:</span><span><b>6h</b> trabalhadas</span><span aria-hidden="true">−</span><span><b>4h</b> de jornada normal</span><span aria-hidden="true">=</span><strong>2h extras</strong></div><p>Você pode cadastrar menos de 4 horas extras. O limite é <strong>4 horas extras por dia</strong>.</p><p class="hel-calculo-ajuste">Se for necessário adaptar os horários para o sistema calcular corretamente, a alteração será mostrada antes de você confirmar.</p></div></details></div>
                <div id="helConsultaCompacta" style="margin-top:8px">
                    <button type="button" class="hel-btn" id="helConsultarExistentes">Atualizar</button>
                    <a class="hel-btn" href="ConsultaRegistro.aspx" target="_blank" rel="noopener">Abrir consulta</a>
                    <div id="helConsultaStatus" class="hel-note" role="status">Selecione o servidor para consultar os dias cadastrados.</div>
                    <details id="helExistentesDetalhes" style="margin-top:8px"><summary id="helExistentesResumo">Dias já cadastrados</summary><div id="helExistentesLista" class="hel-table-wrap"></div></details>
                </div>

                <div id="helAvisoPeriodo"></div>
                <div id="helErroPeriodo"></div>
            </div>
        </div>

        <div class="hel-section">
            <div class="hel-section-title">Horário</div>
            <div class="hel-section-body">
                <div class="hel-horarios">
                    <div class="hel-field">
                        <label>Entrada</label>
                        <input id="helPadEntrada" value="07:00">
                    </div>
                    <div class="hel-field">
                        <label>Saída / Almoço</label>
                        <input id="helPadSaidaAl" value="11:00">
                    </div>
                    <div class="hel-field">
                        <label>Retorno / Almoço</label>
                        <input id="helPadRetorno" value="11:00">
                    </div>
                    <div class="hel-field">
                        <label>Saída</label>
                        <input id="helPadSaida" value="15:00">
                    </div>
                    <button type="button" class="hel-btn" id="helAplicarPadrao">Aplicar a todas</button>
                </div>
                
            </div>
        </div>

        <div class="hel-section">
            <div class="hel-section-title">
                <span>Dias trabalhados</span>
                <span id="helQtdPrevista" class="hel-section-title-note">0 dias · 00:00 previstas</span>
            </div>
            <div class="hel-section-body">
                <div class="hel-days-row">
                    <input id="helDias" placeholder="Ex.: 25, 1, 12, 3">
                    <button type="button" class="hel-btn hel-btn-main" id="helAdicionarDias">Adicionar dias</button>
                </div>
                <div class="hel-quick-days">
                    <span class="hel-quick-days-label">Preenchimento rápido:</span>
                    <button type="button" class="hel-btn hel-btn-quick" id="helMesInteiro" title="Adiciona todos os dias de segunda a sexta do mês selecionado.">Mês inteiro</button>
                    <button type="button" class="hel-btn hel-btn-quick" id="helPrimeiraQuinzena" title="Adiciona os dias de segunda a sexta do dia 1 ao dia 15.">1ª quinzena</button>
                    <button type="button" class="hel-btn hel-btn-quick" id="helSegundaQuinzena" title="Adiciona os dias de segunda a sexta do dia 16 ao fim do mês.">2ª quinzena</button>
                </div>
                <div class="hel-note">Atalhos ignoram finais de semana e dias já cadastrados. Datas do calendário são avisos: confira o expediente.</div>
                <div id="helAvisosLista" class="hel-input-notices"></div>

                <div class="hel-table-wrap">
                    <table class="hel-table">
                        <thead>
                            <tr>
                                <th>Data</th>
                                <th>Entrada</th>
                                <th>Saída/Almoço</th>
                                <th>Retorno</th>
                                <th>Saída</th>
                                <th>HE prevista</th>
                                <th>HE 50%</th>
                                <th>HE 100%</th>
                                <th>Total</th>
                                <th class="hel-carga-tecnica-col">Cálculo interno</th>
                                <th>Status</th>
                                <th></th>
                            </tr>
                        </thead>
                        <tbody id="helLinhas"></tbody>
                    </table>
                </div>

                <div id="helConferenciaEstado" class="hel-conference-state blocked">0 calculadas / 0 informadas · envio bloqueado</div>

                <details id="helDetalhesCalculo" class="hel-tech-details">
                    <summary>
                        <span>Detalhes do cálculo</span>
                        <span id="helDetalhesCalculoResumo"></span>
                    </summary>
                    <div id="helDetalhesCalculoConteudo" class="hel-tech-details-body"></div>
                </details>

                <div class="hel-actions">
                    <div>
                        <button type="button" class="hel-btn" id="helNovaLinha">+ Linha</button>
                        <button type="button" class="hel-btn hel-btn-danger" id="helLimpar">Limpar</button>
                    </div>
                    <div>
                        <button type="button" class="hel-btn hel-btn-main" id="helCalcular">Calcular / Conferir</button>
                        <button type="button" class="hel-btn hel-btn-send" id="helEnviar" disabled>${MODO_SIMULACAO ? 'Simular envio' : 'Enviar lançamentos'}</button>
                        <button type="button" class="hel-btn" id="helCancelar" style="display:none;">Parar</button>
                    </div>
                </div>

                <div class="hel-progress" id="helProgress">
                    <div class="hel-progress-track"><div id="helProgressBar"></div></div>
                    <div id="helProgressText"></div>
                </div>

                <div id="helMensagem"></div>
            </div>
        </div>

        <div class="hel-section">
            <div class="hel-section-title">Resumo</div>
            <div class="hel-section-body">
                <div id="helResumoHumano" class="hel-summary-human">0 dias · 00:00 previstas</div>
                <table class="hel-summary-table">
                    <tr class="label">
                        <td>Dias informados</td>
                        <td>Dias calculados</td>
                        <td>HE 50%</td>
                        <td>HE 100%</td>
                        <td>Total HE</td>
                        <td>${MODO_SIMULACAO ? 'Simulados' : 'Incluídos'}</td>
                    </tr>
                    <tr class="value">
                        <td id="helResumoInformados">0</td>
                        <td id="helResumoCalculados">0</td>
                        <td id="helResumo50">00:00</td>
                        <td id="helResumo100">00:00</td>
                        <td id="helResumoTotal" class="total">00:00</td>
                        <td id="helResumoIncluidos" class="included">0</td>
                    </tr>
                </table>

                <div style="margin-top:11px; display:flex; gap:6px; justify-content:flex-end; flex-wrap:wrap;">
                    <button type="button" class="hel-btn" id="helCopiarResumo">Copiar resumo</button>
                    <button type="button" class="hel-btn" id="helSalvarLote">Salvar relatório JSON</button>
                    <button type="button" class="hel-btn" id="helNovoLote">Novo lote</button>
                </div>
            </div>
        </div>

        <div class="hel-section" id="helAuditSection" style="display:none;">
            <div class="hel-section-title" id="helAuditTitle">Relatório do processamento</div>
            <div class="hel-section-body">
                <div id="helAuditMeta" class="hel-audit-meta"></div>
                <div class="hel-table-wrap">
                    <table class="hel-audit-table">
                        <thead>
                            <tr>
                                <th>Data</th>
                                <th>HE prevista</th>
                                <th>HE 50%</th>
                                <th>HE 100%</th>
                                <th>Total</th>
                                <th>Resultado</th>
                                <th>Observação</th>
                            </tr>
                        </thead>
                        <tbody id="helAuditBody"></tbody>
                    </table>
                </div>
                <div style="margin-top:10px; text-align:right;">
                    <button type="button" class="hel-btn" id="helCopiarResultado">Copiar resultado</button>
                    <button type="button" class="hel-btn" id="helSalvarRelatorio">Salvar relatório JSON</button>
                </div>
            </div>
        </div>
    `;
    painelOriginal.parentNode.insertBefore(app, painelOriginal);

    // Remove visualmente o cabeçalho antigo e os espaços/BRs que o separavam do formulário.
    if (tituloOriginal) {
        let node = tituloOriginal.nextSibling;
        while (node && node !== app) {
            const next = node.nextSibling;
            const removivel = node === voltarOriginal ||
                node.nodeType === Node.TEXT_NODE ||
                (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR');
            if (removivel) node.remove();
            node = next;
        }
        tituloOriginal.style.display = 'none';
    }
    if (voltarOriginal) voltarOriginal.style.display = 'none';

    // Modal de conferência final
    const modalOverlay = document.createElement('div');
    modalOverlay.className = 'hel-modal-overlay';
    modalOverlay.id = 'helModalPreview';
    modalOverlay.innerHTML = `
        <div class="hel-modal">
            <div class="hel-modal-head">${MODO_SIMULACAO ? 'Conferência final da simulação' : 'Conferência final antes do envio'}</div>
            <div class="hel-modal-body">
                <div class="hel-modal-grid">
                    <div class="hel-modal-item"><span>Servidor</span><strong id="helModalServidor">-</strong></div>
                    <div class="hel-modal-item"><span>RF</span><strong id="helModalRF">-</strong></div>
                    <div class="hel-modal-item"><span>Mês das horas</span><strong id="helModalMesHoras">-</strong></div>
                    <div class="hel-modal-item"><span>Período usual</span><strong id="helModalPeriodoUsual">-</strong></div>
                    <div class="hel-modal-item"><span>Período escolhido</span><strong id="helModalPeriodo">-</strong></div>
                    <div class="hel-modal-item"><span>Quantidade de dias</span><strong id="helModalQtd">0</strong></div>
                    <div class="hel-modal-item"><span>HE 50%</span><strong id="helModal50">00:00</strong></div>
                    <div class="hel-modal-item"><span>HE 100%</span><strong id="helModal100">00:00</strong></div>
                    <div class="hel-modal-item"><span>Total</span><strong id="helModalTotal">00:00</strong></div>
                    <div class="hel-modal-item"><span>Ajustes para cálculo</span><strong id="helModalCargas">Sem ajustes</strong></div>
                </div>

                <div id="helModalHumano" class="hel-modal-human">-</div>
                <div id="helModalContagemFinal" class="hel-final-count"></div>
                <div id="helModalExcecao" class="hel-modal-exception" style="display:none;"></div>
                <div id="helModalOutrosAvisos" class="hel-modal-warning" style="display:none;"></div>
                <div id="helModalCompatResumo" class="hel-compat-summary"></div>

                <div class="hel-modal-checks">
                    <label id="helConfirmExcecaoWrap" class="hel-modal-check">
                        <input type="checkbox" id="helConfirmExcecao">
                        Confirmo o período excepcional informado acima.
                    </label>
                    <label id="helConfirmFuturasWrap" class="hel-modal-check">
                        <input type="checkbox" id="helConfirmFuturas">
                        Confirmo que revisei a(s) data(s) futura(s).
                    </label>
                    <label id="helConfirmCompatWrap" class="hel-modal-check">
                        <input type="checkbox" id="helConfirmCompat">
                        Confirmo que revisei os ajustes para cálculo exibidos acima.
                    </label>
                </div>

                <div style="margin-top:12px; color:#555; font-size:12px;">
                    ${MODO_SIMULACAO ? 'Cada dia será recalculado antes da simulação final.' : 'Cada dia será recalculado imediatamente antes da inclusão. Se o resultado mudar, a linha não será enviada.'}
                </div>
            </div>
            <div class="hel-modal-actions">
                <button type="button" class="hel-btn" id="helModalCancelar">Cancelar</button>
                <button type="button" class="hel-btn hel-btn-send" id="helModalConfirmar">${MODO_SIMULACAO ? 'Confirmar simulação' : 'Confirmar envio'}</button>
            </div>
        </div>
    `;
    document.body.appendChild(modalOverlay);

    // ---------------------------------------------------------------------
    // Reutiliza campos reais do sistema
    // ---------------------------------------------------------------------
    document.getElementById('helServidorBox').appendChild(txtServidor);
    document.getElementById('helRegistroBox').appendChild(txtReg);
    sistemaMes.style.display = 'none';
    sistemaAno.style.display = 'none';
    sistemaCarga.style.display = 'none';
    sistemaCarga.value = '04:00';
    painelOriginal.style.display = 'none';

    const mesHorasEl = document.getElementById('helMesHoras');
    const anoHorasEl = document.getElementById('helAnoHoras');
    const periodoMesEl = document.getElementById('helPeriodoMes');
    const periodoAnoEl = document.getElementById('helPeriodoAno');
    const periodoDiferenteEl = document.getElementById('helPeriodoDiferente');

    const hoje = new Date();
    const anoAtual = hoje.getFullYear();
    for (let y = anoAtual - 2; y <= anoAtual + 2; y++) {
        const o = document.createElement('option');
        o.value = String(y);
        o.textContent = String(y);
        anoHorasEl.appendChild(o);
    }

    MESES.forEach(nome => {
        const o = document.createElement('option');
        o.value = nome;
        o.textContent = nome;
        periodoMesEl.appendChild(o);
    });

    [...sistemaAno.options]
        .filter(o => /^\d{4}$/.test(o.value))
        .forEach(o => {
            const n = document.createElement('option');
            n.value = o.value;
            n.textContent = o.textContent;
            periodoAnoEl.appendChild(n);
        });

    mesHorasEl.value = String(hoje.getMonth() + 1);
    anoHorasEl.value = String(anoAtual);

    // ---------------------------------------------------------------------
    // Utilidades
    // ---------------------------------------------------------------------
    function valor(id) {
        const el = document.getElementById(id);
        return el ? String(el.value || '').trim() : '';
    }

    function valorSet(id, value) {
        const el = document.getElementById(id);
        if (el) el.value = value;
    }

    function escaparHtml(texto) {
        return String(texto ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function dataValida(data) {
        if (!/^\d{2}\/\d{2}\/\d{4}$/.test(data)) return false;
        const [d, m, a] = data.split('/').map(Number);
        const dt = new Date(a, m - 1, d);
        return dt.getFullYear() === a && dt.getMonth() === m - 1 && dt.getDate() === d;
    }

    function dataParaDate(data) {
        if (!dataValida(data)) return null;
        const [d, m, a] = data.split('/').map(Number);
        return new Date(a, m - 1, d);
    }

    function hojeSemHora() {
        const agora = new Date();
        return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    }

    function dataEhFutura(data) {
        const dt = dataParaDate(data);
        return !!dt && dt.getTime() > hojeSemHora().getTime();
    }

    function diaSemanaTexto(data) {
        const dt = dataParaDate(data);
        return dt ? DIAS_SEMANA[dt.getDay()] : '-';
    }

    function diaSemanaEhFimDeSemana(data) {
        const dt = dataParaDate(data);
        return !!dt && (dt.getDay() === 0 || dt.getDay() === 6);
    }

    function dataCurta(data) {
        if (!dataValida(data)) return data || '-';
        return data.substring(0, 5);
    }

    function timestampData(data) {
        const dt = dataParaDate(data);
        return dt ? dt.getTime() : Number.MAX_SAFE_INTEGER;
    }

    function horaValida(hora) {
        if (!/^\d{2}:\d{2}$/.test(hora)) return false;
        const [h, m] = hora.split(':').map(Number);
        return h >= 0 && h <= 23 && m >= 0 && m <= 59;
    }

    function minutosHora(hora) {
        if (!horaValida(hora)) return null;
        const [h, m] = hora.split(':').map(Number);
        return h * 60 + m;
    }

    function segundosHora(hora) {
        if (!hora) return 0;
        const p = hora.split(':').map(Number);
        if (p.some(Number.isNaN)) return 0;
        if (p.length === 2) return p[0] * 3600 + p[1] * 60;
        if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
        return 0;
    }

    function formatarSegundos(total) {
        total = Math.max(0, Math.round(total));
        const h = Math.floor(total / 3600);
        const m = Math.floor((total % 3600) / 60);
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    function formatarHorasHumanas(total) {
        total = Math.max(0, Math.round(total));
        if (total % 3600 === 0) return `${total / 3600}h`;
        return formatarSegundos(total);
    }

    function sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    function mensagem(tipo, texto) {
        const el = document.getElementById('helMensagem');
        el.className = tipo;
        el.textContent = texto;
    }

    function progresso(atual, total, texto) {
        const box = document.getElementById('helProgress');
        box.classList.add('visible');
        const pct = total ? Math.round((atual / total) * 100) : 0;
        document.getElementById('helProgressBar').style.width = pct + '%';
        document.getElementById('helProgressText').textContent = texto || `${atual}/${total}`;
    }

    function ocultarProgresso() {
        document.getElementById('helProgress').classList.remove('visible');
        document.getElementById('helProgressBar').style.width = '0%';
        document.getElementById('helProgressText').textContent = '';
    }

    function infoServidor() {
        const servidor = txtServidor.value.trim();
        const m = servidor.match(/^(\d{6})\s+(.+)$/);
        if (!m) return null;
        return { rf: m[1], nome: m[2].trim(), completo: servidor };
    }

    function atualizarServidorSelecionado() {
        const box = document.getElementById('helServidorSelecionado');
        const info = infoServidor();
        const texto = txtServidor.value.trim();

        if (info) {
            box.className = 'hel-server-selected visible valid';
            box.innerHTML = `Servidor selecionado: <strong>${escaparHtml(info.rf)} — ${escaparHtml(info.nome)}</strong>`;
        } else if (texto) {
            box.className = 'hel-server-selected visible warning';
            box.textContent = 'Selecione o servidor pela lista de sugestões para confirmar RF e nome.';
        } else {
            box.className = 'hel-server-selected';
            box.textContent = '';
        }
    }

    function iniciarNovoLoteEfetivoSeNecessario() {
        if (!auditoriaEhAnterior) return;
        auditoria = [];
        auditoriaMeta = null;
        auditoriaEhAnterior = false;
        renderAuditoria();
    }

    function mostrarAvisosEntrada(avisos) {
        const box = document.getElementById('helAvisosLista');
        if (!avisos || !avisos.length) {
            box.classList.remove('visible');
            box.innerHTML = '';
            return;
        }
        box.innerHTML = avisos.map(a => `<div>${escaparHtml(a)}</div>`).join('');
        box.classList.add('visible');
    }

    // ---------------------------------------------------------------------
    // Período
    // ---------------------------------------------------------------------
    function mesAnoHoras() {
        return {
            mes: Number(mesHorasEl.value),
            ano: Number(anoHorasEl.value)
        };
    }

    function periodoPadrao() {
        const h = mesAnoHoras();
        let mes = h.mes + 1;
        let ano = h.ano;
        if (mes === 13) {
            mes = 1;
            ano++;
        }
        return { mes, ano, nome: MESES[mes - 1] };
    }

    function periodoSelecionado() {
        return {
            nome: periodoMesEl.value,
            mes: MESES.indexOf(periodoMesEl.value) + 1,
            ano: Number(periodoAnoEl.value)
        };
    }

    function periodoEhExcepcional() {
        const p = periodoPadrao();
        const e = periodoSelecionado();
        return e.mes !== p.mes || e.ano !== p.ano;
    }

    function indiceMesAno(mes, ano) {
        return ano * 12 + (mes - 1);
    }

    function erroPeriodoCronologico() {
        const h = mesAnoHoras();
        const p = periodoSelecionado();
        if (!p.mes || !p.ano) return 'Selecione um período válido.';
        if (indiceMesAno(p.mes, p.ano) < indiceMesAno(h.mes, h.ano)) {
            return `Período inválido: ${p.nome}/${p.ano} é anterior ao mês das horas (${MESES[h.mes - 1]}/${h.ano}).`;
        }
        return '';
    }

    function aplicarPeriodoSistema() {
        if (erroPeriodoCronologico()) return false;
        const p = periodoSelecionado();
        const existeMes = [...sistemaMes.options].some(o => o.value === p.nome);
        const existeAno = [...sistemaAno.options].some(o => o.value === String(p.ano));
        if (!existeMes || !existeAno) return false;
        sistemaMes.value = p.nome;
        sistemaAno.value = String(p.ano);
        sistemaCarga.value = '04:00';
        return true;
    }

    function atualizarAvisoPeriodo() {
        const aviso = document.getElementById('helAvisoPeriodo');
        const erroBox = document.getElementById('helErroPeriodo');
        const erro = erroPeriodoCronologico();
        const p = periodoSelecionado();
        const disponivel = [...sistemaMes.options].some(o => o.value === p.nome) &&
            [...sistemaAno.options].some(o => o.value === String(p.ano));

        if (erro) {
            erroBox.style.display = 'block';
            erroBox.textContent = erro;
        } else if (!disponivel) {
            erroBox.style.display = 'block';
            erroBox.textContent = `O período ${p.nome}/${p.ano} não está disponível no formulário oficial.`;
        } else {
            erroBox.style.display = 'none';
            erroBox.textContent = '';
        }

        if (!erro && disponivel && periodoDiferenteEl.checked && periodoEhExcepcional()) {
            const h = mesAnoHoras();
            const padrao = periodoPadrao();
            aviso.style.display = 'block';
            aviso.textContent = `Período excepcional: o usual seria ${padrao.nome}/${padrao.ano}. Horas de ${MESES[h.mes - 1]}/${h.ano} serão lançadas em ${p.nome}/${p.ano}.`;
        } else {
            aviso.style.display = 'none';
            aviso.textContent = '';
        }

        aplicarPeriodoSistema();
        const botaoCalcular = document.getElementById('helCalcular');
        if (botaoCalcular && !processando) botaoCalcular.disabled = !!erro || !disponivel;
        atualizarResumo();
    }

    function atualizarPeriodo() {
        const p = periodoPadrao();
        if (!periodoDiferenteEl.checked) {
            periodoMesEl.value = p.nome;
            periodoAnoEl.value = String(p.ano);
            periodoMesEl.disabled = true;
            periodoAnoEl.disabled = true;
        } else {
            periodoMesEl.disabled = false;
            periodoAnoEl.disabled = false;
        }
        atualizarAvisoPeriodo();
        invalidarPreviaTodas();
        salvarRascunho();
    }

    // ---------------------------------------------------------------------
    // Linhas
    // ---------------------------------------------------------------------
    function dadosLinha(tr) {
        return {
            data: tr.querySelector('.hel-data').value.trim(),
            entrada: tr.querySelector('.hel-entrada').value.trim(),
            saidaAl: tr.querySelector('.hel-saida-al').value.trim(),
            retorno: tr.querySelector('.hel-retorno').value.trim(),
            saida: tr.querySelector('.hel-saida').value.trim()
        };
    }

    function assinaturaLinha(tr) {
        return JSON.stringify(dadosLinha(tr));
    }

    function minutosPeriodo(horaInicio, horaFim) {
        const inicio = minutosHora(horaInicio);
        const fim = minutosHora(horaFim);
        if (inicio === null || fim === null || fim < inicio) return null;
        return fim - inicio;
    }

    function duracoesLinha(linha) {
        const primeiro = minutosPeriodo(linha.entrada, linha.saidaAl);
        const segundo = minutosPeriodo(linha.retorno, linha.saida);
        const intervalo = (horaValida(linha.saidaAl) && horaValida(linha.retorno))
            ? minutosHora(linha.retorno) - minutosHora(linha.saidaAl)
            : null;
        return {
            primeiro,
            segundo,
            intervalo,
            total: primeiro === null || segundo === null ? null : primeiro + segundo
        };
    }

    function formatarMinutos(total) {
        if (total === null || total === undefined || !Number.isFinite(total)) return '-';
        const h = Math.floor(total / 60);
        const m = total % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    function minutosParaHora(total) {
        if (!Number.isFinite(total) || total < 0 || total >= 24 * 60) return null;
        const h = Math.floor(total / 60);
        const m = total % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    function horarioLinhaTexto(linha) {
        return `${linha.entrada}–${linha.saidaAl} / ${linha.retorno}–${linha.saida}`;
    }

    function linhaParaSistema(linha) {
        /*
         * Regra funcional:
         * - o horário informado pelo usuário é o horário real;
         * - a soma real dos blocos menos 4h define a HE (maior que zero e até 4h);
         * - a carga enviada ao sistema permanece SEMPRE 04:00;
         * - quando existe intervalo entre Saída/Almoço e Retorno/Almoço,
         *   o sistema histórico não reconhece corretamente as 4h extras.
         *
         * Compatibilidade aplicada:
         * preserva integralmente o período de HE (Retorno -> Saída) e cria,
         * somente para o POST ao sistema, o primeiro bloco com sua duração real
         * imediatamente anterior ao início da HE.
         *
         * Ex. real 07–11 / 13–17 -> sistema 09–13 / 13–17.
         */
        const erro = validarLinhaCritica(linha, true);
        if (erro) {
            return { ok: false, erro, linhaSistema: null, ajustado: false };
        }

        const retornoMin = minutosHora(linha.retorno);
        const saidaAlMin = minutosHora(linha.saidaAl);

        if (retornoMin === saidaAlMin) {
            return {
                ok: true,
                ajustado: false,
                linhaSistema: { ...linha },
                horarioInformado: horarioLinhaTexto(linha),
                horarioSistema: horarioLinhaTexto(linha)
            };
        }

        const entradaTecnicaMin = retornoMin - duracoesLinha(linha).primeiro;
        const entradaTecnica = minutosParaHora(entradaTecnicaMin);
        if (!entradaTecnica) {
            return {
                ok: false,
                erro: 'O ajuste de compatibilidade atravessaria a meia-noite; este caso exige conferência manual.',
                linhaSistema: null,
                ajustado: false
            };
        }

        const linhaSistema = {
            ...linha,
            entrada: entradaTecnica,
            saidaAl: linha.retorno,
            retorno: linha.retorno,
            saida: linha.saida
        };

        return {
            ok: true,
            ajustado: true,
            linhaSistema,
            horarioInformado: horarioLinhaTexto(linha),
            horarioSistema: horarioLinhaTexto(linhaSistema)
        };
    }

    function horarioPadraoAtual() {
        return {
            entrada: valor('helPadEntrada'),
            saidaAl: valor('helPadSaidaAl'),
            retorno: valor('helPadRetorno'),
            saida: valor('helPadSaida')
        };
    }

    function horarioDifereDoPadrao(tr) {
        const d = dadosLinha(tr);
        const p = horarioPadraoAtual();
        return d.entrada !== p.entrada || d.saidaAl !== p.saidaAl || d.retorno !== p.retorno || d.saida !== p.saida;
    }

    function atualizarVisualData(tr) {
        const data = tr.querySelector('.hel-data').value.trim();
        const dia = tr.querySelector('.hel-dia-semana');
        const textoDia = diaSemanaTexto(data);
        const fimSemana = diaSemanaEhFimDeSemana(data);
        dia.textContent = textoDia === '-' ? '· -' : `· ${textoDia}`;
        dia.classList.toggle('weekend', fimSemana);
        tr.classList.toggle('hel-weekend-invalid', fimSemana);
        tr.classList.toggle('hel-future', dataEhFutura(data));
        if (fimSemana && tr.dataset.incluido !== '1' && tr.dataset.incerto !== '1') {
            aplicarStatusLinha(tr, 'Fim de semana — lançamento não permitido', 'hel-error');
        }
    }

    function aplicarStatusLinha(tr, texto, classe = '') {
        const s = tr.querySelector('.hel-status');
        const content = document.createElement('span');
        content.className = 'hel-status-content';
        const label = document.createElement('span');
        label.className = 'hel-status-text'; label.textContent = texto; label.title = texto;
        content.appendChild(label); s.replaceChildren(content);
        s.className = `hel-status${classe ? ' ' + classe : ''}`;
    }

    function adicionarLinha(data = '', dados = {}, opcoes = {}) {
        if (!opcoes.restaurando) iniciarNovoLoteEfetivoSeNecessario();

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>
                <div class="hel-data-combined">
                    <input class="hel-data" value="${escaparHtml(data)}" placeholder="dd/mm/aaaa">
                    <span class="hel-dia-semana">· ${escaparHtml(diaSemanaTexto(data))}</span>
                </div>
            </td>
            <td><input class="hel-hora hel-entrada" value="${escaparHtml(dados.entrada || valor('helPadEntrada') || '07:00')}"></td>
            <td><input class="hel-hora hel-saida-al" value="${escaparHtml(dados.saidaAl ?? valor('helPadSaidaAl') ?? '11:00')}"></td>
            <td><input class="hel-hora hel-retorno" value="${escaparHtml(dados.retorno ?? valor('helPadRetorno') ?? '11:00')}"></td>
            <td><input class="hel-hora hel-saida" value="${escaparHtml(dados.saida || valor('helPadSaida') || '15:00')}"></td>
            <td class="hel-he hel-prevista">-</td>
            <td class="hel-he hel-he50">-</td>
            <td class="hel-he hel-he100">-</td>
            <td class="hel-he hel-total">-</td>
            <td class="hel-carga-tecnica">-</td>
            <td class="hel-status">Aguardando</td>
            <td><button type="button" class="hel-remove" title="Remover">×</button></td>
        `;

        tr.querySelector('.hel-remove').onclick = () => {
            if (tr.dataset.incluido === '1') {
                alert('Este lançamento já foi incluído no sistema.');
                return;
            }
            if (tr.dataset.incerto === '1') {
                alert('Esta linha está com inclusão sem confirmação. Confira no sistema antes de removê-la ou tentar novo lançamento.');
                return;
            }
            if (linhaJaCadastrada(tr)) {
                alert('Este dia já foi identificado pelo sistema como cadastrado. Use “Novo lote” após concluir a conferência.');
                return;
            }
            tr.remove();
            revalidarDuplicidades();
            atualizarResumo();
            salvarRascunho();
        };

        const inputData = tr.querySelector('.hel-data');
        tr.querySelectorAll('input').forEach(input => {
            input.addEventListener('input', () => {
                invalidarPreviaLinha(tr);
                atualizarVisualData(tr);
                revalidarDuplicidades();
                atualizarResumo();
                salvarRascunho();
            });
        });
        inputData.addEventListener('change', () => {
            ordenarLinhas();
            revalidarDuplicidades();
            atualizarResumo();
        });
        inputData.addEventListener('blur', () => {
            ordenarLinhas();
            revalidarDuplicidades();
        });

        document.getElementById('helLinhas').appendChild(tr);

        if (dados.preview) {
            tr.dataset.preview = '1';
            delete tr.dataset.alteradaAposConferencia;
            tr.classList.remove('hel-dirty');
            tr.dataset.seg50 = String(dados.seg50 || 0);
            tr.dataset.seg100 = String(dados.seg100 || 0);
            tr.dataset.total = String(dados.total || 0);
            tr.dataset.ajusteHorario = dados.ajusteHorario ? '1' : '0';
            tr.dataset.horarioSistema = dados.horarioSistema || '';
            tr.dataset.assinatura = assinaturaLinha(tr);
            tr.querySelector('.hel-he50').textContent = formatarSegundos(Number(dados.seg50 || 0));
            tr.querySelector('.hel-he100').textContent = formatarSegundos(Number(dados.seg100 || 0));
            tr.querySelector('.hel-total').textContent = formatarSegundos(Number(dados.total || 0));
            tr.querySelector('.hel-carga-tecnica').textContent = '-';
        }

        if (dados.incluido) {
            tr.dataset.incluido = '1';
            tr.dataset.contextoTerminal = dados?.contextoTerminal || chaveConsultaAtual();
            tr.dataset.preview = '1';
            tr.dataset.seg50 = String(dados.seg50 || 0);
            tr.dataset.seg100 = String(dados.seg100 || 0);
            tr.dataset.total = String(dados.total || 0);
            tr.dataset.ajusteHorario = dados.ajusteHorario ? '1' : '0';
            tr.dataset.horarioSistema = dados.horarioSistema || '';
            tr.dataset.assinatura = assinaturaLinha(tr);
            aplicarStatusLinha(tr, 'Incluído', 'hel-ok');
            tr.querySelectorAll('input').forEach(i => i.disabled = true);
        } else if (dados.incerto) {
            tr.dataset.incerto = '1';
            tr.dataset.contextoTerminal = chaveConsultaAtual();
            tr.dataset.preview = '1';
            tr.dataset.seg50 = String(dados.seg50 || 0);
            tr.dataset.seg100 = String(dados.seg100 || 0);
            tr.dataset.total = String(dados.total || 0);
            tr.dataset.ajusteHorario = dados.ajusteHorario ? '1' : '0';
            tr.dataset.horarioSistema = dados.horarioSistema || '';
            tr.dataset.assinatura = assinaturaLinha(tr);
            tr.classList.add('hel-uncertain');
            aplicarStatusLinha(tr, '⚠ Inclusão sem confirmação — conferir no sistema', 'hel-warning');
            tr.querySelectorAll('input, button').forEach(i => i.disabled = true);
        } else if (dados.jaExistia) {
            tr.dataset.jaExistia = '1';
            tr.dataset.contextoTerminal = chaveConsultaAtual();
            tr.dataset.preview = '1';
            tr.dataset.seg50 = String(dados.seg50 || 0);
            tr.dataset.seg100 = String(dados.seg100 || 0);
            tr.dataset.total = String(dados.total || 0);
            tr.dataset.ajusteHorario = dados.ajusteHorario ? '1' : '0';
            tr.dataset.horarioSistema = dados.horarioSistema || '';
            tr.dataset.assinatura = assinaturaLinha(tr);
            aplicarStatusLinha(tr, 'Já cadastrado nesta data', 'hel-warning');
            tr.querySelectorAll('input').forEach(i => i.disabled = true);
        } else if (dados.alteradaAposConferencia) {
            tr.dataset.alteradaAposConferencia = '1';
            tr.classList.add('hel-dirty');
            aplicarStatusLinha(tr, '⚠ Alterado após conferência — calcular novamente', 'hel-warning');
        } else if (dados.preview) {
            const total = Number(dados.total || 0);
            const avisos = [];
            if (horarioDifereDoPadrao(tr)) avisos.push('horário diferente do padrão');
            if (dataEhFutura(dadosLinha(tr).data)) avisos.push('data futura');
            if (total === heEsperadaSegundos(dadosLinha(tr))) {
                aplicarStatusLinha(tr, avisos.length ? `Conferido · ${avisos.join(' · ')}` : '✓ Conferido', avisos.length ? 'hel-warning' : 'hel-ok');
            } else {
                aplicarStatusLinha(tr, `Revisar: ${formatarSegundos(total)}`, 'hel-warning');
            }
        }

        if (dados.conferenciaConsulta) tr.dataset.conferenciaConsulta = dados.conferenciaConsulta;
        if (dados.conferenciaMensagem) tr.dataset.conferenciaMensagem = dados.conferenciaMensagem;
        if (dados.registroVerificado) tr.dataset.registroVerificado = JSON.stringify(dados.registroVerificado);
        atualizarVisualData(tr);
        atualizarResumo();
        return tr;
    }

    function invalidarPreviaLinha(tr) {
        if (tr.dataset.incluido === '1' || tr.dataset.incerto === '1' || linhaJaCadastrada(tr)) return;

        const haviaConferencia =
            tr.dataset.preview === '1' ||
            tr.dataset.alteradaAposConferencia === '1';

        delete tr.dataset.preview;
        delete tr.dataset.seg50;
        delete tr.dataset.seg100;
        delete tr.dataset.total;
        delete tr.dataset.ajusteHorario;
        delete tr.dataset.horarioSistema;
        delete tr.dataset.assinatura;

        tr.querySelector('.hel-he50').textContent = '-';
        tr.querySelector('.hel-he100').textContent = '-';
        tr.querySelector('.hel-total').textContent = '-';
        tr.querySelector('.hel-carga-tecnica').textContent = '-';

        if (haviaConferencia) {
            tr.dataset.alteradaAposConferencia = '1';
            tr.classList.add('hel-dirty');
            aplicarStatusLinha(
                tr,
                '⚠ Alterado após conferência — calcular novamente',
                'hel-warning'
            );
        } else {
            delete tr.dataset.alteradaAposConferencia;
            tr.classList.remove('hel-dirty');
            aplicarStatusLinha(tr, 'Aguardando');
        }

        atualizarResumo();
    }

    function invalidarPreviaTodas() {
        document.querySelectorAll('#helLinhas tr').forEach(invalidarPreviaLinha);
        atualizarResumo();
    }

    function ordenarLinhas() {
        const tbody = document.getElementById('helLinhas');
        const linhas = [...tbody.querySelectorAll('tr')];
        linhas.sort((a, b) => timestampData(a.querySelector('.hel-data').value.trim()) - timestampData(b.querySelector('.hel-data').value.trim()));
        linhas.forEach(tr => tbody.appendChild(tr));
        salvarRascunho();
    }

    function revalidarDuplicidades() {
        const mapa = new Map();
        const linhas = [...document.querySelectorAll('#helLinhas tr')];

        linhas.forEach(tr => {
            tr.classList.remove('hel-duplicate');
            if (tr.dataset.incluido === '1' || tr.dataset.incerto === '1' || linhaJaCadastrada(tr)) return;
            const data = tr.querySelector('.hel-data').value.trim();
            if (!data) return;
            if (!mapa.has(data)) mapa.set(data, []);
            mapa.get(data).push(tr);
        });

        mapa.forEach(arr => {
            if (arr.length > 1) {
                arr.forEach(tr => {
                    tr.classList.add('hel-duplicate');
                    aplicarStatusLinha(tr, 'Data já informada neste lote', 'hel-error');
                });
            }
        });
    }

    function adicionarDias() {
        const texto = valor('helDias');
        if (!texto) return;

        const ref = mesAnoHoras();
        const existentes = new Set(
            [...document.querySelectorAll('#helLinhas .hel-data')]
                .map(i => i.value.trim())
                .filter(Boolean)
        );

        const itens = texto.split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
        let adicionados = 0;
        const avisos = [];

        itens.forEach(item => {
            let data = '';
            if (/^\d{1,2}$/.test(item)) {
                data = `${String(Number(item)).padStart(2, '0')}/${String(ref.mes).padStart(2, '0')}/${ref.ano}`;
            } else if (/^\d{2}\/\d{2}\/\d{4}$/.test(item)) {
                data = item;
            } else {
                avisos.push(`${item} — valor inválido`);
                return;
            }

            if (!dataValida(data)) {
                avisos.push(`${item} — data inválida`);
                return;
            }

            const [, m, a] = data.split('/').map(Number);
            if (m !== ref.mes || a !== ref.ano) {
                avisos.push(`${dataCurta(data)} — não pertence a ${MESES[ref.mes - 1]}/${ref.ano}`);
                return;
            }

            if (diaSemanaEhFimDeSemana(data)) {
                avisos.push(`${dataCurta(data)} · ${diaSemanaTexto(data)} — fim de semana, lançamento não permitido`);
                return;
            }

            if (existentes.has(data)) {
                avisos.push(`${dataCurta(data)} — já estava na lista`);
                return;
            }

            existentes.add(data);
            adicionarLinha(data);
            adicionados++;
        });

        valorSet('helDias', '');
        ordenarLinhas();
        revalidarDuplicidades();
        mostrarAvisosEntrada(avisos);
        atualizarResumo();
        salvarRascunho();

        if (adicionados) {
            mensagem(avisos.length ? 'warning' : 'success', `${adicionados} dia(s) adicionado(s) e ordenado(s).${avisos.length ? ' Confira os avisos acima.' : ''}`);
        } else if (avisos.length) {
            mensagem('warning', 'Nenhum novo dia foi adicionado. Confira os avisos acima.');
        }
    }


    async function adicionarFaixaDiasUteis(inicio, fim, rotulo) {
        if (processando || consultando) return;
        if (!await conferirFeriadosParaAcao()) return;
        if (!await atualizarExistentes()) return;
        iniciarNovoLoteEfetivoSeNecessario();

        const ref = mesAnoHoras();
        const ultimoDia = new Date(ref.ano, ref.mes, 0).getDate();
        const primeiro = Math.max(1, Number(inicio) || 1);
        const ultimo = Math.min(ultimoDia, Number(fim) || ultimoDia);

        const existentes = new Set(
            [...document.querySelectorAll('#helLinhas .hel-data')]
                .map(i => i.value.trim())
                .filter(Boolean)
        );

        const avisos = [];
        let adicionados = 0;
        let ignoradosFimSemana = 0;
        const feriadosIgnorados = [];
        let duplicados = 0;
        let jaCadastrados = 0;

        for (let dia = primeiro; dia <= ultimo; dia++) {
            const data = `${String(dia).padStart(2, '0')}/${String(ref.mes).padStart(2, '0')}/${ref.ano}`;

            if (!dataValida(data)) continue;
            if (registrosExistentes.has(data)) { jaCadastrados++; continue; }

            if (diaSemanaEhFimDeSemana(data)) {
                ignoradosFimSemana++;
                continue;
            }

            if(bloquearFeriadosNacionais()&&consultasCalendario.get(ref.ano)?.mapa.get(data)?.nacional){feriadosIgnorados.push(data);continue;}
            if (existentes.has(data)) {
                duplicados++;
                continue;
            }

            existentes.add(data);
            adicionarLinha(data);
            adicionados++;
        }

        ordenarLinhas();
        revalidarDuplicidades();
        atualizarResumo();
        salvarRascunho();

        if (jaCadastrados) avisos.push(jaCadastrados + ' dia(s) já cadastrados no sistema não foram adicionados');
        if (duplicados) {
            avisos.push(`${duplicados} dia(s) útil(eis) já estavam na lista e foram mantidos apenas uma vez`);
        }
        if (ignoradosFimSemana) {
            avisos.push(`${ignoradosFimSemana} sábado(s)/domingo(s) foram ignorados automaticamente`);
        }

        mostrarAvisosEntrada(jaCadastrados ? [jaCadastrados + (jaCadastrados === 1 ? ' dia já está cadastrado e ficou fora desta lista.' : ' dias já estão cadastrados e ficaram fora desta lista.') + ' Se algum estiver errado, use Excluir em Ver cadastrados ou em Consulta e exclusão; depois cadastre novamente.'] : []);

        if(feriadosIgnorados.length)mostrarAvisosEntrada([...(jaCadastrados?[jaCadastrados+' dia(s) já cadastrados ficaram fora da lista. Se estiverem errados, exclua antes de cadastrar novamente.']:[]),feriadosIgnorados.length+' feriado(s) nacional(is) não adicionados: '+feriadosIgnorados.join(', ')+'.']);
        const nomeMes = `${MESES[ref.mes - 1]}/${ref.ano}`;
        if (adicionados) {
            mensagem(
                'success',
                `${rotulo}: ${adicionados} adicionados · ${jaCadastrados} já cadastrados · ${duplicados} já na lista.`
            );
        } else {
            mensagem(
                'warning',
                `${rotulo}: nenhum novo dia adicionado · ${jaCadastrados} já cadastrados · ${duplicados} já na lista.`
            );
        }
    }

    function adicionarMesInteiro() {
        const ref = mesAnoHoras();
        adicionarFaixaDiasUteis(1, new Date(ref.ano, ref.mes, 0).getDate(), 'Mês inteiro');
    }

    function adicionarPrimeiraQuinzena() {
        adicionarFaixaDiasUteis(1, 15, '1ª quinzena');
    }

    function adicionarSegundaQuinzena() {
        const ref = mesAnoHoras();
        adicionarFaixaDiasUteis(16, new Date(ref.ano, ref.mes, 0).getDate(), '2ª quinzena');
    }

    function aplicarHorarioPadrao() {
        document.querySelectorAll('#helLinhas tr').forEach(tr => {
            if (tr.dataset.incluido === '1' || tr.dataset.incerto === '1' || linhaJaCadastrada(tr)) return;
            tr.querySelector('.hel-entrada').value = valor('helPadEntrada');
            tr.querySelector('.hel-saida-al').value = valor('helPadSaidaAl');
            tr.querySelector('.hel-retorno').value = valor('helPadRetorno');
            tr.querySelector('.hel-saida').value = valor('helPadSaida');
            invalidarPreviaLinha(tr);
        });
        atualizarResumo();
        salvarRascunho();
    }

    // ---------------------------------------------------------------------
    // Validações
    // ---------------------------------------------------------------------
    function validarServidor() {
        const info = infoServidor();
        if (!info) {
            return 'Selecione o servidor pela lista de sugestões do sistema. Não deixe apenas o RF digitado.';
        }
        if (!txtReg.value.trim()) {
            return 'Selecione o servidor pela lista de sugestões até o registro funcional ser preenchido pelo sistema.';
        }
        if (txtReg.value.trim() !== info.rf) {
            return 'O registro exibido não corresponde ao servidor selecionado.';
        }
        return '';
    }

    function heEsperadaSegundos(linha) {
        const dur = duracoesLinha(linha);
        return dur.total === null ? 0 : Math.max(0, dur.total - JORNADA_NORMAL_MINUTOS) * 60;
    }

    function validarHorarios(linha) {
        if (!horaValida(linha.entrada)) return 'Entrada inválida';
        if (!horaValida(linha.saidaAl)) return 'Saída/Almoço inválida';
        if (!horaValida(linha.retorno)) return 'Retorno/Almoço inválido';
        if (!horaValida(linha.saida)) return 'Saída inválida';
        const entrada = minutosHora(linha.entrada), almoco = minutosHora(linha.saidaAl);
        const retorno = minutosHora(linha.retorno), saida = minutosHora(linha.saida);
        if (almoco <= entrada) return 'Saída/Almoço deve ser posterior à entrada';
        if (retorno < almoco) return 'Retorno anterior à saída do almoço';
        if (saida <= retorno) return 'Saída deve ser posterior ao retorno';
        const he = heEsperadaSegundos(linha);
        if (he <= 0) return 'A jornada não gera HE: o trabalho efetivo precisa superar a carga normal de 4h';
        if (he > HE_LIMITE_SEGUNDOS) return 'HE prevista de ' + formatarSegundos(he) + ' excede o limite diário de 04:00';
        return '';
    }

    function validarLinhaCritica(linha, ignorarPendencia = false) {
        if (!dataValida(linha.data)) return 'Data inválida';

        const ref = mesAnoHoras();
        const [, mesData, anoData] = linha.data.split('/').map(Number);
        if (mesData !== ref.mes || anoData !== ref.ano) {
            return `Data fora de ${MESES[ref.mes - 1]}/${ref.ano}`;
        }

        if(!ignorarPendencia){try{const info=infoServidor();if(info&&listarExclusoesPendentesHE(info.rf).some(o=>o.data===linha.data))return 'Exclusão pendente de confirmação — verifique as pendências';if(info&&erroMigracaoHE(info.rf))return erroMigracaoHE(info.rf);if(info)listarOperacoesHE(info.rf);if(info&&lerOperacaoHE(info.rf,linha.data))return 'Inclusão pendente de confirmação — verifique as pendências';}catch{return 'Não foi possível ler os bloqueios de inclusão — envio impedido';}}
        if (diaSemanaEhFimDeSemana(linha.data)) {
            return 'Fim de semana — lançamento não permitido';
        }

        if(bloquearFeriadosNacionais()){
            const c=consultasCalendario.get(ref.ano);
            if(!calendarioNacionalConfirmado(ref.ano))return 'Feriados não confirmados — consulte novamente';
            if(c.mapa.get(linha.data)?.nacional)return 'Feriado: '+c.mapa.get(linha.data).nome+' — opção Considerar feriados desmarcada';
        }
        return validarHorarios(linha);
    }

    function validarTudo() {
        const erroServidor = validarServidor();
        if (erroServidor) {
            mensagem('error', erroServidor);
            return null;
        }

        const erroPeriodo = erroPeriodoCronologico();
        if (erroPeriodo) {
            mensagem('error', erroPeriodo);
            return null;
        }

        if (!aplicarPeriodoSistema()) {
            mensagem('error', 'O período escolhido não está disponível no sistema.');
            return null;
        }

        sistemaCarga.value = '04:00';
        revalidarDuplicidades();

        const ref = mesAnoHoras();
        const linhas = [...document.querySelectorAll('#helLinhas tr')];
        if (!linhas.length) {
            mensagem('error', 'Adicione pelo menos um dia.');
            return null;
        }

        if (linhas.some(tr => tr.dataset.contextoTerminal && tr.dataset.contextoTerminal !== chaveConsultaAtual())) {
            mensagem('error', 'Existem resultados de outro servidor ou período nesta lista. Salve o relatório e use Novo lote antes de continuar.');
            return null;
        }
        if (linhas.some(tr => tr.dataset.incerto === '1')) {
            mensagem('error', 'Há lançamento com inclusão sem confirmação. Confira essa linha no sistema antes de continuar.');
            return null;
        }

        const datas = new Set();
        let erros = 0;

        linhas.forEach(tr => {
            if (tr.dataset.incluido === '1' || linhaJaCadastrada(tr)) return;
            const linha = dadosLinha(tr);
            let erro = '';

            delete tr.dataset.dataFutura;
            delete tr.dataset.horarioDiferente;
            tr.classList.remove('hel-future', 'hel-horario-diferente');

            erro = validarLinhaCritica(linha);
            if (!erro && datas.has(linha.data)) erro = 'Data já informada neste lote';
            datas.add(linha.data);

            if (!erro && horarioDifereDoPadrao(tr)) {
                tr.dataset.horarioDiferente = '1';
                tr.classList.add('hel-horario-diferente');
            }
            if (!erro && dataEhFutura(linha.data)) {
                tr.dataset.dataFutura = '1';
                tr.classList.add('hel-future');
            }

            if (erro) {
                erros++;
                aplicarStatusLinha(tr, erro, 'hel-error');
                if (erro.includes('já informada')) tr.classList.add('hel-duplicate');
                if (erro.includes('Fim de semana')) tr.classList.add('hel-weekend-invalid');
                return;
            }

            if (tr.dataset.preview === '1') {
                const total = Number(tr.dataset.total || 0);
                const avisos = [];
                if (tr.dataset.horarioDiferente === '1') avisos.push('horário diferente do padrão');
                if (tr.dataset.dataFutura === '1') avisos.push('data futura');
                if (total === heEsperadaSegundos(dadosLinha(tr))) {
                    aplicarStatusLinha(tr, avisos.length ? `Conferido · ${avisos.join(' · ')}` : '✓ Conferido', avisos.length ? 'hel-warning' : 'hel-ok');
                } else {
                    aplicarStatusLinha(tr, `Revisar: ${formatarSegundos(total)}`, 'hel-warning');
                }
            } else {
                const avisos = [];
                if (tr.dataset.horarioDiferente === '1') avisos.push('Horário diferente do padrão');
                if (tr.dataset.dataFutura === '1') avisos.push('Data futura');
                aplicarStatusLinha(tr, avisos.length ? avisos.join(' · ') : 'Pronto para calcular', avisos.length ? 'hel-warning' : 'hel-ok');
            }
        });

        if (erros) {
            mensagem('error', `${erros} lançamento(s) precisam ser corrigidos.`);
            atualizarResumo();
            return null;
        }

        ordenarLinhas();
        atualizarResumo();
        return [...document.querySelectorAll('#helLinhas tr')];
    }

    // ---------------------------------------------------------------------
    // ASP.NET WebForms
    // ---------------------------------------------------------------------
    // Regra importante desta versão:
    // - a carga horária enviada permanece sempre 04:00;
    // - o horário real informado pelo usuário nunca é alterado na interface;
    // - quando necessário, somente o POST usa um primeiro bloco técnico
    //   contínuo de 4h antes das 4h extras;
    // - a inclusão parte EXATAMENTE do HTML/VIEWSTATE devolvido pelo cálculo.

    function limparBotoesDePost(params) {
        params.delete('Button1');
        params.delete('btIncluir');
        return params;
    }

    function parametrosDoFormularioAtual() {
        return limparBotoesDePost(new URLSearchParams(new FormData(form)));
    }

    function parametrosDoDocumento(doc) {
        const formResposta = doc?.querySelector('#form1') || doc?.querySelector('form');
        if (!formResposta) {
            throw new Error('A resposta do sistema não contém o formulário esperado.');
        }
        return limparBotoesDePost(new URLSearchParams(new FormData(formResposta)));
    }

    async function estadoInicial() {
        if (MODO_SIMULACAO) {
            return new URLSearchParams();
        }

        // Não faz GET auxiliar. O snapshot vem da própria página autenticada
        // que o usuário está vendo, mantendo VIEWSTATE, EVENTVALIDATION e
        // campos auxiliares pertencentes ao mesmo carregamento.
        const viewstate = form.querySelector('input[name="__VIEWSTATE"]')?.value || '';
        const eventValidation = form.querySelector('input[name="__EVENTVALIDATION"]')?.value || '';
        if (!viewstate || !eventValidation) {
            throw new Error('O estado ASP.NET da página não está disponível. Recarregue a página e tente novamente.');
        }
        return parametrosDoFormularioAtual();
    }

    function clonarEstadoBase(estado) {
        if (estado instanceof URLSearchParams) {
            return new URLSearchParams(estado.toString());
        }
        if (estado?.nodeType === Node.DOCUMENT_NODE) {
            return parametrosDoDocumento(estado);
        }
        if (estado?.doc?.nodeType === Node.DOCUMENT_NODE) {
            return parametrosDoDocumento(estado.doc);
        }
        throw new Error('Estado interno do formulário inválido. Recarregue a página.');
    }

    function montarParametros(estado, linha, acao) {
        const params = clonarEstadoBase(estado);
        params.delete('Button1');
        params.delete('btIncluir');
        params.set('__EVENTTARGET', '');
        params.set('__EVENTARGUMENT', '');

        // O ScriptManager pode ser preenchido em runtime pelo AjaxControlToolkit.
        // Se a resposta HTML vier com esse hidden vazio, reaproveita o valor
        // coerente carregado na página atual.
        if (toolkitAtual && !String(params.get('ToolkitScriptManager1_HiddenField') || '').trim()) {
            params.set('ToolkitScriptManager1_HiddenField', toolkitAtual);
        }

        params.set('txtServidor', txtServidor.value.trim());
        params.set('DropDownList1', sistemaMes.value);
        params.set('anoPeriodo', sistemaAno.value);
        params.set('DropDownList2', CARGA_SISTEMA);
        params.set('txtData', linha.data);
        params.set('txtEntrada', linha.entrada);
        params.set('txtSaidaAl', linha.saidaAl);
        params.set('txtRetornoAl', linha.retorno);
        params.set('txtSaida', linha.saida);

        [
            'txtData_MaskedEditExtender_ClientState',
            'txtEntrada_MaskedEditExtender_ClientState',
            'txtSaidaAl_MaskedEditExtender_ClientState',
            'txtRetornoAl_MaskedEditExtender_ClientState',
            'txtSaida_MaskedEditExtender_ClientState',
            'txtHE50_MaskedEditExtender_ClientState',
            'txtHE100_MaskedEditExtender_ClientState',
            'txtNoturno_MaskedEditExtender_ClientState'
        ].forEach(nome => {
            if (!params.has(nome)) params.set(nome, '');
        });

        if (acao === 'calcular') params.set('Button1', 'Calcular Horas');
        else params.set('btIncluir', 'Incluir');
        return params;
    }

    function extrairMensagensSistema(html, doc) {
        const mensagens = [];

        const regexAlert = /alert\(\s*['\"]([^'\"]+)['\"]\s*\)/gi;
        let match;
        while ((match = regexAlert.exec(html || '')) !== null) {
            const texto = String(match[1] || '').trim();
            if (texto && !mensagens.includes(texto)) mensagens.push(texto);
        }

        if (doc) {
            const lbl = doc.querySelector('#LblMensagem');
            const textoLbl = String(lbl?.textContent || '').trim();
            if (textoLbl && !mensagens.includes(textoLbl)) mensagens.push(textoLbl);

            doc.querySelectorAll('span[id^="MaskedEditValidator"]').forEach(el => {
                const style = String(el.getAttribute('style') || '').toLowerCase();
                const texto = String(el.textContent || '').trim();
                if (texto && !style.includes('display:none') && !mensagens.includes(texto)) mensagens.push(texto);
            });
        }

        return mensagens;
    }

    function validarContratoCalculoHE(doc,linha){
        const f=doc?.querySelector?.('#form1'),info=infoServidor();
        const falhar=()=>{throw Error('O cálculo retornou dados incompletos ou de outro contexto. Nenhuma inclusão será enviada; recarregue e confira o servidor, a folha e os horários.');};
        if(!f||!info)return falhar();
        for(const name of ['__VIEWSTATE','__EVENTVALIDATION'])if(!f.querySelector('input[name="'+name+'"]')?.value?.trim())return falhar();
        const destino=new URL(f.getAttribute('action')||location.href,location.href),pagina=new URL(location.href);
        if(destino.origin!==pagina.origin||destino.pathname.toLowerCase()!==pagina.pathname.toLowerCase())return falhar();
        const servidor=String(f.querySelector('#txtServidor')?.value||'').trim().match(/^(\d{6})\s+(.+)$/);
        const reg=f.querySelector('#txtReg');if(!reg)return falhar();
        const rfVisual=String(reg.value||'').trim();
        if(!servidor||normalizarRF(servidor[1])!==normalizarRF(info.rf)||(rfVisual&&normalizarRF(rfVisual)!==normalizarRF(info.rf)))return falhar();
        const esperado={DropDownList1:sistemaMes.value,anoPeriodo:sistemaAno.value,DropDownList2:CARGA_SISTEMA,txtData:linha.data,txtEntrada:linha.entrada,txtSaidaAl:linha.saidaAl,txtRetornoAl:linha.retorno,txtSaida:linha.saida};
        for(const [id,value]of Object.entries(esperado))if(String(f.querySelector('#'+id)?.value||'').trim()!==String(value))return falhar();
        return true;
    }

    async function post(estado, linha, acao) {
        if (MODO_SIMULACAO) {
            await sleep(80);
            if (acao === 'calcular') {
                // Simulação apenas para desenvolvimento. Em produção esta
                // ramificação nunca é usada.
                const entrada = minutosHora(linha.entrada);
                const saida = minutosHora(linha.saida);
                const cargaMin = minutosHora(CARGA_SISTEMA);
                const totalSeg = (entrada === null || saida === null || cargaMin === null || saida <= entrada)
                    ? 0
                    : Math.max(0, (saida - entrada - cargaMin) * 60);
                return {
                    html: '<!-- simulação: cálculo -->',
                    doc: null,
                    estado: new URLSearchParams(),
                    mensagens: [],
                    simulacaoResultado: {
                        retornado: true,
                        he50: formatarSegundos(totalSeg) + ':00',
                        he100: '',
                        seg50: totalSeg,
                        seg100: 0,
                        total: totalSeg
                    }
                };
            }
            const sim = lerBaseSimulada();
            const info = infoServidor(), p = periodoSelecionado();
            const repetido = sim.some(r => normalizarRF(r.rf) === normalizarRF(info.rf) && r.data === linha.data);
            if (repetido) return { html: '', doc: null, estado: new URLSearchParams(), mensagens: ['Já existe horas extras lançadas para este funcionário nesta data'] };
            if (window.__HEL_SIM_INCLUSAO__ === 'falha-sem-gravar') throw new Error('Falha simulada antes de gravar');
            sim.push({ rf: info.rf, nome: info.nome, periodo: p.nome, ano: String(p.ano), ...linha,
                he50: formatarSegundos(heEsperadaSegundos(linha)), he100: '00:00', heSegundos: heEsperadaSegundos(linha) });
            if (window.__HEL_SIM_INCLUSAO__ === 'divergente') {
                sim[sim.length-1].heSegundos += 3600;
                sim[sim.length-1].he50 = formatarSegundos(sim[sim.length-1].heSegundos);
            }
            localStorage.setItem('pg_he_beta45_sim_base', JSON.stringify(sim));
            if (window.__HEL_SIM_INCLUSAO__ === 'falha-apos-gravar') throw new Error('Resposta perdida depois de gravar');
            return {
                html: "<script language=JavaScript>alert('Dados incluídos com sucesso')</" + "script>;",
                doc: null,
                estado: new URLSearchParams(),
                mensagens: ['Dados incluídos com sucesso']
            };
        }

        if(acao==='incluir')validarContratoCalculoHE(estado?.doc||estado,linha);
        const params = montarParametros(estado, linha, acao);
        const abort = new AbortController();
        const limite = 30000;
        const timer = setTimeout(() => abort.abort(), limite);
        let resposta, html;
        try {
            resposta = await fetch(form.action || location.href, {
                method:'POST', credentials:'same-origin', signal:abort.signal,
                headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'}, body:params.toString()
            });
            html = await resposta.text();
            if (!resposta.ok) throw new Error('Erro HTTP ' + resposta.status + '.');
        } catch(e) {
            if (abort.signal.aborted) throw new Error(acao === 'incluir' ? 'A inclusão demorou mais de 30 segundos. O resultado será conferido pela consulta; não reenvie automaticamente.' : 'O cálculo demorou mais de 30 segundos. Tente novamente depois de conferir a conexão.');
            throw e;
        } finally { clearTimeout(timer); }

        const esperadoURL=new URL(location.href),retornoURL=new URL(resposta.url||location.href);
        if(retornoURL.origin!==esperadoURL.origin||retornoURL.pathname.toLowerCase()!==esperadoURL.pathname.toLowerCase())throw Error('O cálculo retornou outra página. Recarregue e confira a sessão.');
        const doc = new DOMParser().parseFromString(html, 'text/html');
        if(acao==='calcular')validarContratoCalculoHE(doc,linha);
        if (!doc.querySelector('#txtServidor') || !doc.querySelector('input[name="__VIEWSTATE"]')) {
            throw new Error('O sistema retornou uma página inesperada. A sessão pode ter expirado.');
        }

        // "estado" passa a ser o DOCUMENTO integral devolvido pelo servidor.
        // Isso é essencial para o Incluir utilizar exatamente o VIEWSTATE e
        // EVENTVALIDATION do cálculo correspondente.
        return {
            html,
            doc,
            estado: doc,
            mensagens: extrairMensagensSistema(html, doc)
        };
    }

    function resultadoCalculo(resposta) {
        if (resposta.simulacaoResultado) return resposta.simulacaoResultado;

        const bruto50 = resposta.doc?.querySelector('#txtHE50')?.value?.trim() || '';
        const bruto100 = resposta.doc?.querySelector('#txtHE100')?.value?.trim() || '';

        // Campo vazio não significa 00:00. Esse era um dos erros das versões
        // anteriores: uma resposta sem cálculo acabava aparecendo como zero.
        const retornado = bruto50 !== '' || bruto100 !== '';
        if (!retornado) {
            return {
                retornado: false,
                he50: '',
                he100: '',
                seg50: 0,
                seg100: 0,
                total: 0
            };
        }

        const formatoValido = v => !v || duracaoRetornadaValida(v);
        if (!formatoValido(bruto50) || !formatoValido(bruto100)) {
            return {
                retornado: false,
                he50: bruto50,
                he100: bruto100,
                seg50: 0,
                seg100: 0,
                total: 0
            };
        }

        const seg50 = bruto50 ? segundosHora(bruto50) : 0;
        const seg100 = bruto100 ? segundosHora(bruto100) : 0;
        return {
            retornado: true,
            he50: bruto50,
            he100: bruto100,
            seg50,
            seg100,
            total: seg50 + seg100
        };
    }

    function sincronizarEstadoDaPagina(doc) {
        if (!doc || MODO_SIMULACAO) return;
        const formResposta = doc.querySelector('#form1') || doc.querySelector('form');
        if (!formResposta) return;

        formResposta.querySelectorAll('input[type="hidden"][name]').forEach(origem => {
            const nome = origem.name;
            const destino = [...form.querySelectorAll('input[type="hidden"][name]')]
                .find(el => el.name === nome);
            if (destino) destino.value = origem.value;
        });
    }

    // ---------------------------------------------------------------------
    // Compatibilidade de horário com o sistema original
    // ---------------------------------------------------------------------
    async function calcularComCompatibilidade(linha) {
        const compat = linhaParaSistema(linha);

        if (!compat.ok) {
            return {
                ok: false,
                bloqueado: true,
                erro: compat.erro,
                compat
            };
        }

        const estado = await estadoInicial();
        const resposta = await post(estado, compat.linhaSistema, 'calcular');
        const resultado = resultadoCalculo(resposta);

        console.debug('[HE Lote] cálculo com compatibilidade de horário', {
            data: linha.data,
            horarioInformado: compat.horarioInformado,
            horarioSistema: compat.horarioSistema,
            ajusteAplicado: compat.ajustado,
            carga: CARGA_SISTEMA,
            retornouHoras: resultado.retornado,
            he50: resultado.he50 || '',
            he100: resultado.he100 || '',
            total: resultado.retornado ? formatarSegundos(resultado.total) : '(sem cálculo)',
            mensagens: resposta.mensagens || []
        });

        return {
            ok: resultado.retornado && resultado.total === heEsperadaSegundos(linha),
            resposta,
            resultado,
            compat,
            mensagens: resposta.mensagens || []
        };
    }

    // ---------------------------------------------------------------------
    // Resumo e auditoria
    // ---------------------------------------------------------------------
    function todosProntosParaEnviar() {
        const todas = [...document.querySelectorAll('#helLinhas tr')];
        if (!todas.length || consultando || !consultaConfirmada || consultaContexto !== chaveConsultaAtual()) return false;
        if (todas.some(tr => tr.dataset.incerto === '1')) return false;

        const pendentes = todas.filter(tr => tr.dataset.incluido !== '1' && !linhaJaCadastrada(tr));
        if (!pendentes.length) return false;

        return pendentes.every(tr =>
            tr.dataset.preview === '1' &&
            Number(tr.dataset.total || 0) === heEsperadaSegundos(dadosLinha(tr)) &&
            tr.dataset.assinatura === assinaturaLinha(tr) &&
            tr.dataset.alteradaAposConferencia !== '1' &&
            !validarLinhaCritica(dadosLinha(tr)) &&
            !tr.classList.contains('hel-duplicate') &&
            !tr.classList.contains('hel-weekend-invalid')
        );
    }

    function renderDetalhesCalculo() {
        const details = document.getElementById('helDetalhesCalculo');
        const resumo = document.getElementById('helDetalhesCalculoResumo');
        const conteudo = document.getElementById('helDetalhesCalculoConteudo');

        if (!details || !resumo || !conteudo) return;

        const linhas = [...document.querySelectorAll('#helLinhas tr')].filter(tr =>
            tr.dataset.preview === '1' ||
            tr.dataset.incluido === '1' ||
            linhaJaCadastrada(tr) ||
            tr.dataset.incerto === '1'
        );

        if (!linhas.length) {
            details.style.display = 'none';
            details.open = false;
            resumo.textContent = '';
            conteudo.innerHTML = '';
            return;
        }

        const ajustadas = linhas.filter(tr => tr.dataset.ajusteHorario === '1');

        details.style.display = '';
        resumo.textContent = ajustadas.length
            ? `${ajustadas.length} com ajuste`
            : 'sem ajustes';

        if (!ajustadas.length) {
            conteudo.innerHTML = `
                <div class="hel-tech-note">
                    Nenhum lançamento conferido precisou de ajuste de compatibilidade.
                    O horário real e o horário enviado ao sistema permaneceram iguais.
                </div>
            `;
            return;
        }

        const linhasHtml = ajustadas
            .slice()
            .sort((a, b) => timestampData(dadosLinha(a).data) - timestampData(dadosLinha(b).data))
            .map(tr => {
                const real = dadosLinha(tr);
                const compat = linhaParaSistema(real);
                const total = Number(tr.dataset.total || 0);

                return `
                    <tr>
                        <td>${escaparHtml(real.data)}</td>
                        <td class="hel-tech-time">${escaparHtml(compat.horarioInformado || '-')}</td>
                        <td class="hel-tech-time hel-tech-system">${escaparHtml(compat.horarioSistema || '-')}</td>
                        <td>${escaparHtml(formatarSegundos(total))}</td>
                    </tr>
                `;
            })
            .join('');

        conteudo.innerHTML = `
            <div class="hel-tech-note">
                O horário real permanece registrado na tela. O horário técnico abaixo é usado
                para compatibilidade com o cálculo; esses horários técnicos são gravados na base. A carga continua em 04:00.
            </div>
            <table class="hel-tech-table">
                <thead>
                    <tr>
                        <th>Data</th>
                        <th>Horário real</th>
                        <th>Enviado ao sistema</th>
                        <th>HE validada</th>
                    </tr>
                </thead>
                <tbody>${linhasHtml}</tbody>
            </table>
        `;
    }

    function atualizarResumo() {
        observarContextoConsulta();
        aplicarRegistrosExistentes();
        const linhas = [...document.querySelectorAll('#helLinhas tr')];
        let calculados = 0;
        let incluidos = 0;
        let total50 = 0;
        let total100 = 0;

        linhas.forEach(tr => {
            if (tr.dataset.preview === '1' || tr.dataset.incluido === '1' || tr.dataset.incerto === '1') {
                calculados++;
                total50 += Number(tr.dataset.seg50 || 0);
                total100 += Number(tr.dataset.seg100 || 0);
            }
            if (tr.dataset.incluido === '1') incluidos++;
        });

        const elegiveis = linhas.filter(tr => {
            const data = dadosLinha(tr).data;
            return dataValida(data) && !diaSemanaEhFimDeSemana(data);
        });
        const previstos = elegiveis.filter(tr => !linhaJaCadastrada(tr) && tr.dataset.incluido !== '1' && !validarLinhaCritica(dadosLinha(tr))).reduce((sum, tr) => sum + heEsperadaSegundos(dadosLinha(tr)), 0);
        document.getElementById('helResumoInformados').textContent = linhas.length;
        document.getElementById('helResumoCalculados').textContent = calculados;
        document.getElementById('helResumo50').textContent = formatarSegundos(total50);
        document.getElementById('helResumo100').textContent = formatarSegundos(total100);
        document.getElementById('helResumoTotal').textContent = formatarSegundos(total50 + total100);
        document.getElementById('helResumoIncluidos').textContent = incluidos;
        const bloqueadosFimSemana = linhas.length - elegiveis.length;
        document.getElementById('helResumoHumano').textContent = bloqueadosFimSemana
            ? `${linhas.length} dia(s) informados · ${elegiveis.length} dia(s) útil(eis) · HE pendente: ${formatarHorasHumanas(previstos)} previstas`
            : `${linhas.length} dia(s) · HE pendente: ${formatarHorasHumanas(previstos)} previstas`;
        document.getElementById('helQtdPrevista').textContent = bloqueadosFimSemana
            ? `${elegiveis.length} elegível(is) · ${formatarHorasHumanas(previstos)} previstas`
            : `${linhas.length} dia(s) · ${formatarHorasHumanas(previstos)} previstas`;

        const estado = document.getElementById('helConferenciaEstado');
        const incertos = linhas.filter(tr => tr.dataset.incerto === '1').length;
        const jaCadastrados = linhas.filter(tr => linhaJaCadastrada(tr)).length;
        const alteradasAposConferencia = linhas.filter(tr => tr.dataset.alteradaAposConferencia === '1').length;
        renderPendenciasHE();
        renderRecuperacaoExclusoesHE();
        atualizarRecursosConferencia();
        const pronto = !processando && todosProntosParaEnviar() && !erroPeriodoCronologico();

        if (incertos) {
            estado.className = 'hel-conference-state error';
            estado.textContent = `${calculados} calculadas / ${linhas.length} informadas · ${incertos} inclusão(ões) sem confirmação · envio bloqueado`;
        } else if (alteradasAposConferencia) {
            estado.className = 'hel-conference-state blocked';
            estado.textContent = `${alteradasAposConferencia} lançamento(s) alterado(s) após a conferência · calcular novamente antes do envio`;
        } else if (pronto) {
            estado.className = 'hel-conference-state ready';
            estado.textContent = `${calculados} calculadas / ${linhas.length} informadas · ${MODO_SIMULACAO ? 'pronto para simulação' : 'pronto para envio'}${jaCadastrados ? ` · ${jaCadastrados} já cadastrado(s)` : ''}`;
        } else if (linhas.length && linhas.every(tr => tr.dataset.incluido === '1' || linhaJaCadastrada(tr))) {
            const conferidos = linhas.filter(tr => tr.dataset.conferenciaConsulta === 'conferido').length;
            const revisar = linhas.filter(tr => tr.dataset.incluido === '1' && tr.dataset.conferenciaConsulta !== 'conferido').length;
            estado.className = 'hel-conference-state ' + (revisar ? 'blocked' : 'ready');
            estado.textContent = 'Lote concluído · ' + conferidos + ' conferido(s) · ' + revisar + ' a revisar · ' + jaCadastrados + ' já cadastrado(s)';
        } else if (jaCadastrados && linhas.every(tr => tr.dataset.incluido === '1' || linhaJaCadastrada(tr))) {
            estado.className = 'hel-conference-state ready';
            estado.textContent = `Processamento concluído · ${incluidos} incluído(s) · ${jaCadastrados} já cadastrado(s)`;
        } else {
            estado.className = 'hel-conference-state blocked';
            estado.textContent = `${calculados} calculadas / ${linhas.length} informadas · envio bloqueado${jaCadastrados ? ` · ${jaCadastrados} já cadastrado(s)` : ''}`;
        }

        renderCalendario();
        const botaoEnviar = document.getElementById('helEnviar');
        if (botaoEnviar && !processando) botaoEnviar.disabled = !pronto;

        renderDetalhesCalculo();
        atualizarLayoutCompacto();
    }

    function metaAuditoriaAtual() {
        const info = infoServidor();
        const h = mesAnoHoras();
        const p = periodoSelecionado();
        return {
            servidor: info?.completo || txtServidor.value.trim() || '-',
            rf: info?.rf || '-',
            nome: info?.nome || '-',
            mesHoras: `${MESES[h.mes - 1]}/${h.ano}`,
            periodo: `${p.nome}/${p.ano}`,
            criadoEm: new Date().toISOString()
        };
    }

    function adicionarAuditoria(item) {
        const tr = [...document.querySelectorAll('#helLinhas tr')].find(tr => dadosLinha(tr).data === item.data);
        if (tr) {
            const real = dadosLinha(tr), compat = linhaParaSistema(real);
            item.horarioReal = horarioLinhaTexto(real);
            item.horarioSistema = compat.horarioSistema || '';
            item.hePrevista = formatarSegundos(heEsperadaSegundos(real));
        }
        if (!auditoriaMeta) auditoriaMeta = metaAuditoriaAtual();
        auditoria.push(item);
        renderAuditoria();
        salvarRascunho();
    }

    function renderAuditoria() {
        const section = document.getElementById('helAuditSection');
        const body = document.getElementById('helAuditBody');
        const metaBox = document.getElementById('helAuditMeta');
        const title = document.getElementById('helAuditTitle');
        body.innerHTML = '';

        if (!auditoria.length) {
            section.style.display = 'none';
            metaBox.textContent = '';
            return;
        }

        section.style.display = '';
        title.textContent = MODO_SIMULACAO
            ? (auditoriaEhAnterior ? 'Última simulação' : 'Relatório da simulação')
            : (auditoriaEhAnterior ? 'Relatório do lote anterior' : 'Relatório do processamento');

        const confirmados = auditoria.filter(a => a.ok);
        const jaCadastrados = auditoria.filter(a => a.jaExistia).length;
        const totalConfirmado = confirmados.reduce((s, a) => s + segundosHora(a.total || '00:00'), 0);
        const meta = auditoriaMeta || metaAuditoriaAtual();
        metaBox.innerHTML = `<strong>${escaparHtml(meta.rf)} — ${escaparHtml(meta.nome)}</strong><br>` +
            `Mês das horas: ${escaparHtml(meta.mesHoras)} · Período: ${escaparHtml(meta.periodo)} · ` +
            (MODO_SIMULACAO
                ? `Simulados: ${confirmados.length} · Total simulado: ${formatarSegundos(totalConfirmado)}`
                : `Incluídos confirmados: ${confirmados.length}${jaCadastrados ? ` · Já cadastrados: ${jaCadastrados}` : ''} · Total confirmado: ${formatarSegundos(totalConfirmado)}`);

        auditoria.forEach(a => {
            const tr = document.createElement('tr');
            const classe = a.conferenciaConsulta && a.conferenciaConsulta !== 'conferido' ? 'hel-warning' : a.ok ? 'hel-ok' : ((a.incerto || a.jaExistia) ? 'hel-warning' : 'hel-error');
            tr.innerHTML = `
                <td>${escaparHtml(a.data || '-')}</td>
                <td>${escaparHtml(a.hePrevista || '—')}</td>
                <td>${escaparHtml(a.he50 || '00:00')}</td>
                <td>${escaparHtml(a.he100 || '00:00')}</td>
                <td>${escaparHtml(a.total || '00:00')}</td>
                <td class="${classe}">${escaparHtml(a.resultado || '-')}</td>
                <td>${escaparHtml(a.observacao || '')}</td>
            `;
            body.appendChild(tr);
        });
    }

    function textoAuditoria() {
        const meta = auditoriaMeta || metaAuditoriaAtual();
        const confirmados = auditoria.filter(a => a.ok);
        const jaCadastrados = auditoria.filter(a => a.jaExistia).length;
        const totalConfirmado = confirmados.reduce((s, a) => s + segundosHora(a.total || '00:00'), 0);
        const cab = [
            MODO_SIMULACAO ? 'RESULTADO - SIMULAÇÃO DE HORAS EXTRAS' : 'RESULTADO - HORAS EXTRAS',
            '',
            `Servidor: ${meta.rf} — ${meta.nome}`,
            `Mês das horas: ${meta.mesHoras}`,
            `Período: ${meta.periodo}`,
            `${MODO_SIMULACAO ? 'Simulados' : 'Incluídos confirmados'}: ${confirmados.length}`,
            ...(!MODO_SIMULACAO && jaCadastrados ? [`Já cadastrados anteriormente: ${jaCadastrados}`] : []),
            `${MODO_SIMULACAO ? 'Total simulado' : 'Total confirmado'}: ${formatarSegundos(totalConfirmado)}`,
            ''
        ];
        const linhas = auditoria.map(a => `${a.data} | HE50 ${a.he50} | HE100 ${a.he100} | Total ${a.total} | ${a.resultado}${a.observacao ? ' | ' + a.observacao : ''}`);
        return cab.concat(linhas).join('\n');
    }

    // ---------------------------------------------------------------------
    // Bloqueio de edição durante processamento
    // ---------------------------------------------------------------------
    function setBloqueado(bloqueado) {
        app.classList.toggle('hel-locked', bloqueado);
        const seletores = [
            '#txtServidor', '#helMesHoras', '#helAnoHoras', '#helPeriodoMes', '#helPeriodoAno', '#helPeriodoDiferente',
            '#helConsiderarFeriados', '#helPadEntrada', '#helPadSaidaAl', '#helPadRetorno', '#helPadSaida', '#helDias',
            '#helAdicionarDias', '#helMesInteiro', '#helPrimeiraQuinzena', '#helSegundaQuinzena',
            '#helNovaLinha', '#helLimpar', '#helAplicarPadrao', '#helCalcular', '#helEnviar',
            '#helVerificarSistema', '#helConsultarExistentes', '#helNovoLote', '#helRestaurarRascunho', '#helDescartarRascunho', '#helDraftSelect'
        ];
        seletores.forEach(sel => {
            const el = document.querySelector(sel);
            if (el) el.disabled = bloqueado;
        });
        document.querySelectorAll('#helLinhas input, #helLinhas button').forEach(el => {
            const tr = el.closest('tr');
            if (el.classList.contains('hel-comparar')) { el.disabled = bloqueado; return; }
            if (tr?.dataset.incluido === '1' || tr?.dataset.incerto === '1' || tr?.dataset.jaExistia === '1') {
                el.disabled = true;
            } else {
                el.disabled = bloqueado;
            }
        });
        if (!bloqueado) {
            periodoMesEl.disabled = !periodoDiferenteEl.checked;
            periodoAnoEl.disabled = !periodoDiferenteEl.checked;
        }
        document.getElementById('helCancelar').style.display = bloqueado ? '' : 'none';
        atualizarResumo();
    }

    // ---------------------------------------------------------------------
    // Rascunhos separados por servidor/mês
    // ---------------------------------------------------------------------
    function iniciarLayoutCompacto() {
        const css = document.createElement('style');
        css.textContent = `
            body { padding-bottom: 100px; }
            #hel-app { margin-top:12px; }
            #hel-app .hel-page-header { margin-bottom:10px; padding-top:4px; padding-bottom:8px; }
            #hel-app .hel-section { margin-bottom:10px; }
            #hel-app .hel-section-body { padding:12px 14px; }
            #hel-app .hel-section-title { padding:8px 12px; }
            #hel-app .hel-server-selected { margin:8px 0 4px; padding:6px 10px; }
            #helRegraCalculo { font-size:12px; }
            #helRegraCalculo summary { cursor:pointer; color:#48617a; }
            #helRegraCalculo[open] { padding-bottom:8px; }
            #helConsultaCompacta { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
            #helConsultaCompacta #helConsultaStatus { margin:0; flex:1; }
            #hel-app .hel-periodo-extra { margin-top:8px; padding-top:8px; }
            #hel-app .hel-horarios { display:grid; grid-template-columns:repeat(4,minmax(90px,1fr)) auto; gap:10px; align-items:end; }
            #hel-app .hel-horarios input { width:100%; }
            #hel-app .hel-horarios label { margin-bottom:4px; }
            .hel-day-toolbar { display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; margin:8px 0; }
            .hel-day-toolbar > div { display:flex; gap:6px; flex-wrap:wrap; }
            .hel-drawer { display:none; position:fixed; top:16px; right:16px; bottom:90px; width:390px; background:white; border:1px solid #aeb7bf; border-radius:6px; box-shadow:0 6px 24px #16304b24; z-index:900; overflow:hidden; }
            .hel-drawer.visible { display:flex; flex-direction:column; }
            .hel-drawer-head { display:flex; justify-content:space-between; align-items:center; padding:12px 14px; background:#eef4f9; border-bottom:1px solid #d3dce5; }
            .hel-drawer-head h2 { margin:0; font-size:16px; }
            .hel-drawer-head button { border:0; background:transparent; font-size:24px; cursor:pointer; padding:0 6px; }
            .hel-drawer-body { overflow:auto; padding:12px 14px; }
            .hel-drawer-context { font-size:12px; color:#526579; line-height:1.6; margin-bottom:10px; }
            .hel-drawer-actions { display:flex; gap:6px; margin-bottom:12px; }
            .hel-drawer #helExistentesDetalhes > summary { display:none; }
            .hel-drawer #helExistentesLista { overflow:visible; border:0; }
            .hel-existing-card { padding:10px 0; border-bottom:1px solid #e4e9ef; font-size:12px; }
            .hel-existing-head { display:grid; grid-template-columns:minmax(0,1fr) auto auto; align-items:center; gap:8px; margin-bottom:7px; font-size:13px; }
            .hel-existing-head strong, .hel-existing-head span { white-space:nowrap; }
            .hel-existing-card { display:flow-root; }
            .hel-existing-head span { color:#2f5d86; font-weight:bold; }
            .hel-existing-card summary { color:#5b6f82; cursor:pointer; }
            .hel-existing-time { margin:8px 0 4px; font-size:13px; font-weight:bold; }
            .hel-existing-card small { color:#707070; display:block; margin-top:5px; }
            .hel-footer { position:fixed; bottom:0; left:0; right:0; z-index:1000; background:#fff; border-top:1px solid #aeb7bf; box-shadow:0 -3px 12px #16304b12; padding:12px 24px; display:flex; justify-content:space-between; align-items:center; gap:12px; font-size:13px; }
            #hel-app .hel-footer.hel-actions { margin:0; }
            #helFooterResumo { display:block; font-size:15px; color:#244866; }
            #helFooterEstado { display:block; margin-top:3px; font-size:12px; color:#707070; }
            .hel-folded-summary { margin-bottom:10px; border:1px solid #c9c9c9; background:#fff; }
            .hel-folded-summary > summary { padding:10px 14px; cursor:pointer; font-weight:bold; color:#48617a; }
            .hel-folded-summary > .hel-section { margin-bottom:0 !important; border:0; }
            .hel-folded-summary > .hel-section > .hel-section-title { display:none; }
            @media(min-width:1200px) {
                body.hel-consulta-aberta #hel-app { max-width:calc(100vw - 446px); margin-left:20px; margin-right:426px; }
                body.hel-consulta-aberta #hel-app .hel-grid { grid-template-columns:2fr 100px 1.4fr; }
            }
            @media(max-width:1199px) {
                .hel-drawer { width:min(390px,calc(100vw - 24px)); top:12px; right:12px; }
            }
            @media(max-width:650px) {
                #hel-app .hel-horarios { grid-template-columns:repeat(2,minmax(90px,1fr)); }
                #hel-app .hel-horarios button { grid-column:1 / -1; }
                .hel-footer { padding:9px 12px; flex-wrap:wrap; gap:6px; }
                #helFooterResumo { font-size:13px; }
                #helFooterEstado { display:none; }
                body { padding-bottom:125px; }
                .hel-drawer { bottom:110px; }
            }
            @media print { .hel-footer,.hel-drawer,.hel-day-toolbar { display:none !important; } body { padding-bottom:0; } }
        `;
        document.head.appendChild(css);
        const drawer = document.createElement('aside');
        drawer.id = 'helConsultaDrawer'; drawer.className='hel-drawer';
        drawer.setAttribute('aria-label','Dias já cadastrados'); drawer.setAttribute('aria-hidden','true');
        drawer.innerHTML = '<div class="hel-drawer-head"><h2>Dias já cadastrados</h2><button type="button" id="helFecharCadastrados" aria-label="Fechar consulta">×</button></div><div class="hel-drawer-identificacao"><div id="helDrawerContexto" class="hel-drawer-context"></div><div class="hel-drawer-actions"></div></div><div class="hel-drawer-body"></div>';
        app.appendChild(drawer);
        const cssDrawer=document.createElement('style');cssDrawer.textContent="#hel-app .hel-grid{align-items:start}#helConsultaDrawer .hel-drawer-head{flex:none}#helConsultaDrawer .hel-drawer-identificacao{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;padding:12px 14px;border-bottom:1px solid #d3dce5;flex:none}#helConsultaDrawer .hel-drawer-context{display:flex;flex-direction:column;gap:3px;margin:0;line-height:1.4;overflow-wrap:anywhere}#helConsultaDrawer .hel-drawer-context strong{font-size:13px;color:#244866}#helConsultaDrawer .hel-drawer-context span{font-size:11px}#helConsultaDrawer .hel-drawer-actions{margin:0}#helConsultaDrawer .hel-drawer-consulta-link{font:12px Arial,Helvetica,sans-serif;color:#2f5d86;white-space:nowrap;text-decoration:none;padding:5px 0}#helConsultaDrawer .hel-drawer-consulta-link:hover{text-decoration:underline}#helConsultaDrawer .hel-drawer-consulta-link:focus-visible{outline:2px solid #2f5d86;outline-offset:3px}#helConsultaDrawer .hel-drawer-body{padding:0 14px 12px;min-height:0;flex:1}#helConsultaDrawer .hel-existing-card{padding:9px 0}#helConsultaDrawer .hel-existing-head{gap:8px;margin-bottom:5px;font-size:12px}#helConsultaDrawer .hel-excluir-cadastrado{min-height:28px;font-size:11px;background:#fff;border-color:#d0b0b0}#helConsultaDrawer .hel-existing-card summary{font-size:11px}#helConsultaDrawer #helExistentesDetalhes{margin-top:0!important}";document.head.appendChild(cssDrawer);
        const compact = document.getElementById('helConsultaCompacta');
        const abrirConsulta=compact.querySelector('a');abrirConsulta.className='hel-drawer-consulta-link';abrirConsulta.textContent='Consulta completa ↗';abrirConsulta.setAttribute('aria-label','Abrir consulta completa em uma nova aba');drawer.querySelector('.hel-drawer-actions').appendChild(abrirConsulta);
        drawer.querySelector('.hel-drawer-body').appendChild(document.getElementById('helExistentesDetalhes'));
        const cssCalculo=document.createElement('style');cssCalculo.textContent="#helRegraCalculo .hel-calculo-info{margin-top:8px;padding:10px 12px;border:1px solid #d4dce3;border-radius:3px;color:#465866;font-size:12px;line-height:1.5}#helRegraCalculo .hel-calculo-info p{margin:0 0 7px}#helRegraCalculo .hel-calculo-info p:last-child{margin-bottom:0}.hel-calculo-exemplo{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin:8px 0;padding:8px 10px;background:#f4f6f8;color:#344b5e}.hel-calculo-exemplo>strong{color:#216c3b}.hel-calculo-ajuste{padding-top:7px;border-top:1px solid #e4e9ef;color:#59666f}";document.head.appendChild(cssCalculo);
        const rules=document.getElementById('helRegraCalculo');
        app.querySelector('.hel-horarios').parentElement.appendChild(rules.parentElement);
        const daySection = document.getElementById('helDias').closest('.hel-section-body');
        const toolbar = document.createElement('div'); toolbar.className='hel-day-toolbar';
        const toggle=document.createElement('button');toggle.type='button';toggle.id='helVerCadastrados';toggle.className='hel-btn';toggle.textContent='Ver cadastrados';
        toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls','helConsultaDrawer');
        const actions=app.querySelector('.hel-actions');
        toolbar.appendChild(actions.firstElementChild);
        toolbar.firstElementChild.appendChild(document.getElementById('helNovoLote'));
        toolbar.appendChild(toggle);
        daySection.insertBefore(toolbar, daySection.querySelector('.hel-table-wrap'));
        const summary=document.createElement('div');summary.innerHTML='<strong id="helFooterResumo">0 dias pendentes · 00:00 previstas</strong><span id="helFooterEstado">Adicione os dias trabalhados</span>';
        actions.insertBefore(summary, actions.firstElementChild);actions.classList.add('hel-footer');
        const folded=document.createElement('details');folded.className='hel-folded-summary';
        folded.innerHTML='<summary>Resumo e relatórios</summary>';
        const section=document.getElementById('helResumoHumano').closest('.hel-section');
        section.before(folded);folded.appendChild(section);
        function close() { drawer.classList.remove('visible');drawer.setAttribute('aria-hidden','true');document.body.classList.remove('hel-consulta-aberta');toggle.setAttribute('aria-expanded','false');toggle.focus(); }
        toggle.onclick=()=>{if(drawer.classList.contains('visible')){close();return;}drawer.classList.add('visible');drawer.setAttribute('aria-hidden','false');document.body.classList.add('hel-consulta-aberta');toggle.setAttribute('aria-expanded','true');document.getElementById('helFecharCadastrados').focus();atualizarLayoutCompacto();};
        document.getElementById('helFecharCadastrados').onclick=close;
        document.addEventListener('keydown',e=>{if(e.key==='Escape' && drawer.classList.contains('visible') && !modalOverlay.classList.contains('visible'))close();});
    }

    function atualizarLayoutCompacto() {
        const button=document.getElementById('helVerCadastrados');
        if (!button) return;
        const confirmed=consultaConfirmada && consultaContexto===chaveConsultaAtual();
        button.textContent=confirmed ? 'Ver cadastrados ('+registrosExistentes.size+')' : 'Ver cadastrados';
        const info=infoServidor(),p=periodoSelecionado();
        document.getElementById('helDrawerContexto').innerHTML='<strong>'+escaparHtml(info?info.nome:'Selecione um servidor')+'</strong><span>'+(info?'RF: '+escaparHtml(info.rf)+' · ':'')+escaparHtml(p.nome)+'/'+escaparHtml(String(p.ano))+'</span>';
        const rows=[...document.querySelectorAll('#helLinhas tr')];
        const pending=rows.filter(tr=>tr.dataset.incluido!=='1' && !linhaJaCadastrada(tr));
        const expected=pending.filter(tr=>!validarLinhaCritica(dadosLinha(tr))).reduce((sum,tr)=>sum+heEsperadaSegundos(dadosLinha(tr)),0);
        document.getElementById('helFooterResumo').textContent=pending.length+' dia(s) pendente(s) · '+formatarSegundos(expected)+' previstas';
        document.getElementById('helFooterEstado').textContent=consultando ? 'Consultando dias cadastrados…' : !confirmed ? 'Consulta pendente · envio bloqueado' : rows.some(tr=>tr.dataset.incerto==='1') ? 'Inclusão sem confirmação · conferir no sistema' : rows.some(tr=>tr.dataset.incluido==='1' && tr.dataset.conferenciaConsulta!=='conferido') ? 'Resultado requer revisão · use Verificar no sistema' : todosProntosParaEnviar() ? 'Conferido · pronto para enviar' : pending.length ? 'Confira os horários e calcule antes do envio' : 'Nenhum dia pendente';
    }


    function bloquearFeriadosNacionais(){return document.getElementById('helConsiderarFeriados')?.checked===false;}
    function calendarioNacionalConfirmado(ano){const c=consultasCalendario.get(ano);return !!c?.em&&!c.erro&&!c.pendente&&Date.now()-c.em<900000&&[...c.mapa.values()].every(r=>r.classificacaoConfirmada);}
    async function conferirFeriadosParaAcao(){
        if(!bloquearFeriadosNacionais())return true;
        const ano=mesAnoHoras().ano;processando=true;setBloqueado(true);
        try{
            await consultarCalendario(ano,true);
            if(!calendarioNacionalConfirmado(ano)){mensagem('error','Não foi possível confirmar os feriados de '+ano+'. Tente novamente ou marque Considerar feriados para continuar com os avisos.');return false;}
            return true;
        }finally{processando=false;setBloqueado(false);atualizarResumo();}
    }
    function iniciarOpcaoFeriados(){
        const label=document.createElement('label');label.style.cssText='display:inline-flex;align-items:center;gap:5px;white-space:nowrap';label.innerHTML='<input type="checkbox" id="helConsiderarFeriados" title="Marcada: permite cadastrar feriados nacionais. Desmarcada: bloqueia os feriados nacionais consultados."> Considerar feriados?';
        app.querySelector('.hel-quick-days').appendChild(label);
        const input=document.getElementById('helConsiderarFeriados');input.checked=false;
        const note=app.querySelector('.hel-quick-days').nextElementSibling;
        const explicar=()=>{if(note)note.textContent=bloquearFeriadosNacionais()?'Feriados nacionais bloqueados. Atalhos ignoram essas datas; feriados locais e pontos facultativos continuam como avisos.':'Feriados permitidos. Atalhos ignoram finais de semana e dias já cadastrados. Confira os avisos do calendário.';};
        input.onchange=async()=>{if(processando||consultando)return;invalidarPreviaTodas();explicar();if(!input.checked)await conferirFeriadosParaAcao();atualizarResumo();};explicar();
    }

    const revisoesPendenciasHE=new Map();
    function operacaoConfereRegistro(op,r){
        if(!r)return false;const l=op.linha;
        return r.data===op.data&&r.entrada===l.entrada&&r.saidaAl===l.saidaAl&&r.retorno===l.retorno&&r.saida===l.saida&&segundosHora(r.he50)===op.seg50&&segundosHora(r.he100)===op.seg100;
    }
    function renderPendenciasHE(){
        const box=document.getElementById('helPendenciasHE');if(!box)return;
        const info=infoServidor();let ops=[];
        try{if(info)ops=listarOperacoesHE(info.rf);}catch(e){box.hidden=false;box.textContent='Não foi possível ler as inclusões pendentes. O envio fica bloqueado: '+e.message;return;}
        let recuperacoes=[];try{if(info)recuperacoes=listarRecuperacoesHE(info.rf);}catch(e){box.hidden=false;box.textContent='Dados antigos não puderam ser lidos. O envio permanece bloqueado: '+e.message;return;}
        const erroAntigo=info&&erroMigracaoHE(info.rf);
        box.hidden=!ops.length&&!erroAntigo;if(box.hidden)return;
        box.innerHTML='<summary>Pendências de inclusão'+(ops.length?' ('+ops.length+')':'')+'</summary>'+(erroAntigo?'<p role="alert">'+escaparHtml(erroAntigo)+' Nenhum rascunho foi apagado. Confira as pendências antes de corrigir os dados locais.</p>':'')+'<div style="padding:8px 0">Esses dias continuam bloqueados até conferir o resultado. <button type="button" class="hel-btn" id="helReverPendencias">Verificar pendências</button></div>'+ops.map(op=>'<div style="padding:6px 0">'+escaparHtml(op.data)+' · Folha '+escaparHtml(op.periodo.nome+'/'+op.periodo.ano)+' <span>'+escaparHtml(revisoesPendenciasHE.get(op.id)?.texto||'Aguardando conferência')+'</span>'+(revisoesPendenciasHE.get(op.id)?.ausente?'<button type="button" class="hel-btn hel-revisao-pendencia" data-id="'+escaparHtml(op.id)+'">Revisão manual</button>':'')+'</div>').join('');
        if(recuperacoes.length){box.insertAdjacentHTML('beforeend','<p>Dados antigos foram preservados separadamente. A revisão não cadastra nem restaura horários.</p>'+recuperacoes.map(b=>'<button type="button" class="hel-btn hel-rever-antigo" data-id="'+escaparHtml(b.id)+'">Revisar bloqueio de dados antigos</button>').join(''));box.querySelectorAll('.hel-rever-antigo').forEach(b=>{b.disabled=processando||consultando;b.onclick=()=>revisarDadosAntigosHE(b.dataset.id);});}
        document.getElementById('helReverPendencias').disabled=processando||consultando;
        document.getElementById('helReverPendencias').onclick=conferirPendenciasHE;
        box.querySelectorAll('.hel-revisao-pendencia').forEach(b=>{b.disabled=processando||consultando;b.onclick=()=>revisarPendenciaManualHE(b.dataset.id);});
    }
    async function conferirPendenciasHE() {try{return await executarOperacaoExclusivaHE(()=>conferirPendenciasHEProtegido());}catch(e){mensagem('warning',e.message);}}
    async function conferirPendenciasHEProtegido() {
        if(processando||consultando)return;const info=infoServidor();if(!info)return;
        processando=true;setBloqueado(true);let confirmados=0;
        try{
            for(const op of listarOperacoesHE(info.rf)){
                const mapa=await obterExistentes(info,op.periodo),r=mapa.get(op.data);
                if(operacaoConfereRegistro(op,r)){concluirOperacaoHE(op,'confirmada-pela-consulta');confirmados++;}
                else revisoesPendenciasHE.set(op.id,{ausente:!r,em:Date.now(),texto:r?'Encontrado com diferença. Confira pela Consulta.':'Não localizado. A ausência não libera um novo envio automaticamente.'});
            }
            mensagem(confirmados?'success':'warning',confirmados+' inclusão(ões) confirmada(s). As demais permanecem bloqueadas.');
        }catch(e){revisoesPendenciasHE.clear();mensagem('warning','A conferência não foi concluída. As pendências continuam bloqueadas: '+e.message);}
        finally{processando=false;setBloqueado(false);renderPendenciasHE();}
    }
    async function revisarPendenciaManualHE(id) {try{return await executarOperacaoExclusivaHE(()=>revisarPendenciaManualHEProtegido(id));}catch(e){mensagem('warning',e.message);}}
    async function revisarPendenciaManualHEProtegido(id) {
        if(processando||consultando)return;const info=infoServidor(),op=info&&listarOperacoesHE(info.rf).find(o=>o.id===id),rev=revisoesPendenciasHE.get(id);
        if(!op||!rev?.ausente||Date.now()-rev.em>300000){mensagem('warning','Verifique as pendências novamente antes da revisão manual.');return;}
        processando=true;setBloqueado(true);
        try{
            const mapa=await obterExistentes(info,op.periodo);
            if(mapa.has(op.data))throw Error('Esse dia aparece na consulta. Confira o registro; ele não será liberado pela revisão manual.');
            const ok=confirm('Liberar uma inclusão sem confirmação?\n\n'+op.rf+' — '+op.nome+'\n'+op.data+' · Folha '+op.periodo.nome+'/'+op.periodo.ano+'\nHorários: '+horarioLinhaTexto(op.linha)+'\n\nA consulta não encontrou esse dia, mas uma solicitação anterior ainda pode terminar. Só confirme se você verificou no sistema que ela não foi cadastrada e não está em processamento.\n\nVocê confirma essa verificação e deseja liberar o dia para uma nova tentativa manual?');
            if(ok){concluirOperacaoHE(op,'liberada-por-revisao-manual');document.querySelectorAll('#helLinhas tr').forEach(tr=>{if(dadosLinha(tr).data===op.data&&tr.dataset.incerto==='1')tr.remove();});mensagem('info','Dia liberado após sua revisão. Nenhuma inclusão foi enviada; informe e calcule novamente se necessário.');}
        }catch(e){mensagem('warning',e.message);}
        finally{processando=false;setBloqueado(false);renderPendenciasHE();}
    }
    async function revisarDadosAntigosHE(id){
        try{await executarOperacaoExclusivaHE(async()=>{
            if(processando||consultando)return;const info=infoServidor();if(!info)return;
            const b=listarRecuperacoesHE(info.rf).find(b=>b.id===id);if(!b)return;
            const escopo=b.rf?'RF '+info.rf+' — '+info.nome:'RF não identificado: todas as pessoas e períodos que poderiam estar nesses dados';
            const ok=confirm('Revisar bloqueio de dados antigos?\n\n'+escopo+'\nOrigem: '+b.chave+'\n\nNão conseguimos ler esses dados. Antes de liberar, confira no sistema oficial todas as possíveis inclusões deste contexto e confirme que não há solicitação anterior em processamento. Se houver dúvida, cancele.\n\nVocê confirma essa conferência e deseja liberar somente este bloqueio? O conteúdo original continuará preservado. Nenhuma inclusão será feita.');
            if(!ok)return;
            concluirRecuperacaoHE(b);mensagem('info','Bloqueio revisado explicitamente. Dados originais preservados; nenhuma inclusão foi enviada.');atualizarResumo();
        });}catch(e){mensagem('warning','O bloqueio continua ativo: '+e.message);}
    }

    let renderRecuperacaoExclusoesHE=()=>{};
    function iniciarPendenciasHE(){
        try{if(migrarBloqueiosAntigosHE().length)mensagem('warning','Há rascunhos antigos danificados. As pendências válidas foram preservadas; os contextos afetados permanecem bloqueados.');}catch(e){errosMigracaoHE=[{rf:null,erro:e.message}];mensagem('warning','Não foi possível preservar pendências anteriores. O envio permanece bloqueado: '+e.message);}
        const box=document.createElement('details');box.id='helPendenciasHE';box.className='hel-note';box.hidden=true;box.style.cssText='margin-top:8px;padding:7px 10px;background:#fff7e3;border-left:3px solid #a76a00';
        document.getElementById('helConsultaCompacta').after(box);
        renderRecuperacaoExclusoesHE=criarRecuperacaoExclusoesHE(document.getElementById('hel-app'),()=>infoServidor()?.rf,op=>obterExistentes({rf:op.rf,nome:op.nome},op.periodo),mensagem,()=>processando||consultando);
        window.addEventListener('storage',e=>{if(e.key===null||(e.key?.startsWith('pg_he_lote_v40_draft::')||e.key?.startsWith('pg_he_recuperacao_rascunho_v48::'))){try{migrarBloqueiosAntigosHE();}catch(error){errosMigracaoHE=[{rf:null,erro:error.message}];}atualizarResumo();}else if(e.key?.includes('inclusao_pendente_v47')){revisoesPendenciasHE.clear();atualizarResumo();}});renderPendenciasHE();
    }

    function calendarioAno(ano) {
        if (cacheCalendario.has(ano)) return cacheCalendario.get(ano);
        const m = new Map();
        const add = (dia,mes,nome,tipo,fonte) => m.set(String(dia).padStart(2,'0')+'/'+String(mes).padStart(2,'0')+'/'+ano,{nome,tipo,fonte});
        // National dates come only from the annual remote query. Local references
        // are partial, dated and advisory; they must never decide eligibility.
        add(9,7,'Revolução Constitucionalista','Estadual/SP','https://www.al.sp.gov.br/repositorio/legislacao/lei/1997/compilacao-lei-9497-05.03.1997.html');
        const municipal='https://www.praiagrande.sp.gov.br/Administracao/leisdecretos_view.asp?codLeis=3345';
        add(29,6,'São Pedro — padroeiro de Praia Grande','Municipal',municipal);
        // Gregorian Easter (Meeus/Jones/Butcher), used to derive the two municipal movable holidays.
        const a=ano%19,b=Math.floor(ano/100),c=ano%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3);
        const h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,n=Math.floor((a+11*h+22*l)/451);
        const mes=Math.floor((h+l-7*n+114)/31),dia=(h+l-7*n+114)%31+1;
        const pascoa=new Date(ano,mes-1,dia,12);
        [-2,60].forEach((delta,index)=>{const dt=new Date(pascoa);dt.setDate(dt.getDate()+delta);add(dt.getDate(),dt.getMonth()+1,index===0?'Sexta-feira da Paixão':'Corpus Christi','Municipal',municipal);});
        cacheCalendario.set(ano,m);return m;
    }
    function feriadoDaData(data) {
        if(!dataValida(data))return null;
        const ano=Number(data.split('/')[2]);
        return calendarioAno(ano).get(data) || consultasCalendario.get(ano)?.mapa?.get(data) || null;
    }
    const consultasCalendario = new Map();
    function avisoCalendario(data) {
        const f=feriadoDaData(data),p=pontoFacultativoDaData(data);
        return [f ? f.nome+' ('+f.tipo+')' : '',p ? 'Ponto facultativo: '+p : ''].filter(Boolean).join(' · ');
    }
    function rotuloCalendario(data) {
        const f=feriadoDaData(data),p=pontoFacultativoDaData(data);
        if(p&&!calendarioAno(Number(data.split('/')[2])).has(data))return 'Ponto facultativo: '+p;
        if(!f)return p?'Ponto facultativo: '+p:'';
        return (/páscoa|carnaval/i.test(f.nome)?'Data a conferir: ':'Feriado: ')+f.nome;
    }
    function renderAvisosModal(pendentes,horariosDiferentes,futuras) {
        const box=document.getElementById('helModalOutrosAvisos'),ano=mesAnoHoras().ano;
        const datas=pendentes.map(tr=>dadosLinha(tr).data).filter(avisoCalendario);
        const bloco=(titulo,conteudo,classe='')=>'<details class="hel-review-block '+classe+'"><summary>'+escaparHtml(titulo)+'</summary><div>'+conteudo+'</div></details>';
        const lista=ds=>ds.map(d=>'<span class="hel-review-date">'+escaparHtml(d)+'</span>').join('');
        let html='';
        if(datas.length)html+=bloco('Feriados e pontos facultativos · '+datas.length+' '+(datas.length===1?'data':'datas')+' para conferir',datas.map(d=>'<div>'+escaparHtml(d)+' · '+escaparHtml(rotuloCalendario(d))+'</div>').join('')+'<p>Confira expediente e autorização da unidade.</p>','hel-review-attention');
        if(futuras.length)html+=bloco('Datas futuras · '+futuras.length+' '+(futuras.length===1?'dia':'dias'),lista(futuras.map(tr=>dadosLinha(tr).data)),'hel-review-attention');
        if(horariosDiferentes.length)html+=bloco('Horários diferentes do padrão · '+horariosDiferentes.length+' '+(horariosDiferentes.length===1?'dia':'dias'),lista(horariosDiferentes.map(tr=>dadosLinha(tr).data)));
        const estado=consultasCalendario.get(ano),situacao=estado?.erro?'Não foi possível consultar':estado?.pendente?'Consultando':estado?.em?'Consultado':'Ainda não consultado';
        const quando=estado?.em ? new Date(estado.em).toLocaleDateString('pt-BR')+' às '+new Date(estado.em).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) : '';
        const texto=estado?.erro ? 'Não conseguimos consultar o calendário agora.'+(quando ? ' Os avisos usam a consulta anterior, feita em '+quando+'.' : ' Pode haver feriados sem aviso na lista.') : estado?.pendente ? 'Estamos consultando os feriados de '+ano+'.' : estado?.em ? 'Os feriados de '+ano+' foram consultados em '+quando+'.' : 'Os feriados de '+ano+' ainda não foram consultados.';
        html+=bloco('Calendário · '+situacao,texto+'<p>Confira com sua unidade se houve mudanças nos feriados ou pontos facultativos. '+(bloquearFeriadosNacionais()?'A opção Considerar feriados está desmarcada: feriados nacionais não serão cadastrados.':'Esses avisos não impedem o envio.')+'</p><p><a target="_blank" rel="noopener" href="https://brasilapi.com.br/api/feriados/v1/'+ano+'">Ver fonte</a></p>',estado?.erro?'hel-review-attention':'');
        box.style.display='';box.innerHTML=html;
    }
    function resumoConsultaCalendario(ano) {
        const c=consultasCalendario.get(ano);
        if(c?.pendente)return 'Consultando calendário de '+ano+'…';
        if(c?.erro)return 'Consulta de '+ano+' indisponível'+(c.em ? '; última resposta recebida em '+new Date(c.em).toLocaleString('pt-BR')+' (desatualizada)' : '; datas nacionais não confirmadas')+'.';
        return c?.em ? 'BrasilAPI · '+ano+' · resposta recebida em '+new Date(c.em).toLocaleString('pt-BR')+'.' : 'Calendário nacional de '+ano+' ainda não consultado.';
    }
    function baixarCalendario(ano) {
        const url='https://brasilapi.com.br/api/feriados/v1/'+ano;
        if(typeof GM_xmlhttpRequest==='function')return new Promise((resolve,reject)=>{
            GM_xmlhttpRequest({method:'GET',url,anonymous:true,timeout:10000,
                onload:r=>{try {if(r.status!==200)throw Error('HTTP '+r.status);resolve(JSON.parse(r.responseText));}catch(e){reject(e);}},
                onerror:()=>reject(Error('Falha de rede')),ontimeout:()=>reject(Error('Tempo esgotado'))});
        });
        return (async()=>{const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
            try {const r=await fetch(url,{credentials:'omit',cache:'no-store',signal:controller.signal});if(!r.ok)throw Error('HTTP '+r.status);return await r.json();}finally{clearTimeout(timer);}})();
    }
    const promessasCalendario = new Map();
    function consultarCalendario(ano,forcar=false) {
        if(promessasCalendario.has(ano)&&consultasCalendario.get(ano)?.pendente)return promessasCalendario.get(ano);
        const p=executarConsultaCalendario(ano,forcar);promessasCalendario.set(ano,p);
        p.finally(()=>{if(promessasCalendario.get(ano)===p)promessasCalendario.delete(ano);});return p;
    }
    async function executarConsultaCalendario(ano,forcar=false) {
        if(!Number.isInteger(ano)||ano<1900||ano>2199)return;
        const anterior=consultasCalendario.get(ano),agora=Date.now();
        if(anterior?.pendente || (!forcar&&anterior?.tentativa&&agora-anterior.tentativa<(anterior.erro?60000:900000)))return;
        const estado={...anterior,pendente:true,tentativa:agora};consultasCalendario.set(ano,estado);renderCalendario(false);
        try {
            const dados=await baixarCalendario(ano),mapa=new Map();
            if(!Array.isArray(dados)||!dados.length||dados.length>100)throw Error('Lista inválida');
            for(const r of dados){
                if(typeof r?.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.date)||typeof r.name!=='string'||!r.name.trim()||r.name.length>200)throw Error('Data inválida');
                if(!['national','state','municipal'].includes(r.type))throw Error('Classificação do calendário não reconhecida');
                const [y,m,d]=r.date.split('-'),data=d+'/'+m+'/'+y;
                if(Number(y)!==ano||!dataValida(data)||mapa.has(data))throw Error('Ano ou data inconsistente');
                mapa.set(data,{nome:r.name,nacional:r.type==='national'&&!/carnaval|p[aá]scoa|corpus christi|sexta.*(?:paix[aã]o|santa)/i.test(r.name),classificacaoConfirmada:['national','state','municipal'].includes(r.type),tipo:'Data informada pela BrasilAPI — conferir classificação',fonte:'https://brasilapi.com.br/api/feriados/v1/'+ano});
            }
            estado.mapa=mapa;estado.em=Date.now();estado.erro='';
        } catch(e){estado.erro=e.message;}
        finally {estado.pendente=false;renderCalendario(false);atualizarResumo();}
    }
    function pontoFacultativoDaData(data) {
        const pontos2026={ '19/01/2026':'Aniversário da cidade', '16/02/2026':'Carnaval', '17/02/2026':'Carnaval', '18/02/2026':'Quarta-feira de Cinzas', '02/04/2026':'Semana Santa', '05/06/2026':'Após Corpus Christi' };
        return pontos2026[data] || null;
    }

    function renderCalendario(consultar=true) {
        const box=document.getElementById('helCalendarioLista');if(!box)return;
        const ref=mesAnoHoras(),estado=consultasCalendario.get(ref.ano),map=new Map(estado?.mapa||[]);
        calendarioAno(ref.ano).forEach((v,k)=>map.set(k,v));
        const rows=[...map.entries()].filter(([data])=>Number(data.split('/')[1])===ref.mes).sort((a,b)=>timestampData(a[0])-timestampData(b[0]));
        const quando=estado?.em?new Date(estado.em).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'';
        const status=estado?.pendente?'Consultando feriados…':estado?.erro?'Não foi possível consultar os feriados. Tente atualizar.':estado?.em?'Feriados consultados em '+quando+'.':'Consulte os feriados antes de cadastrar.';
        box.innerHTML='<div class="hel-calendar-toolbar"><div><strong>Feriados do mês</strong><p>'+escaparHtml(status)+(estado?.erro&&quando?' Última consulta: '+escaparHtml(quando)+'.':'')+'</p></div><button type="button" class="hel-btn" id="helAtualizarCalendario">Atualizar</button></div>';
        box.innerHTML+=rows.length?'<div class="hel-calendar-dates">'+rows.map(([data,r])=>'<div><time>'+escaparHtml(data)+'</time><span>'+escaparHtml(r.nome)+'</span></div>').join('')+'</div>':'<p class="hel-calendar-empty">Nenhuma data sinalizada neste mês.</p>';
        const pontos=[];
        for(let dia=1;dia<=31;dia++){const data=String(dia).padStart(2,'0')+'/'+String(ref.mes).padStart(2,'0')+'/'+ref.ano;const nome=pontoFacultativoDaData(data);if(nome)pontos.push([data,nome]);}
        if(pontos.length)box.innerHTML+='<div class="hel-calendar-points"><strong>Pontos facultativos a conferir</strong>'+pontos.map(([data,nome])=>'<div><time>'+escaparHtml(data)+'</time><span>'+escaparHtml(nome)+'</span></div>').join('')+'</div>';
        box.innerHTML+='<div class="hel-calendar-guidance"><p>'+(bloquearFeriadosNacionais()?'Feriados nacionais ficam fora do cadastro. Para incluí-los, marque “Considerar feriados?”.':'Feriados nacionais podem ser cadastrados. Confira o expediente antes de enviar.')+'</p><p>Confirme feriados locais e pontos facultativos com a unidade. Mudanças recentes podem ainda não aparecer aqui.</p></div>';
        document.getElementById('helCalendarioTitulo').textContent='Calendário · '+MESES[ref.mes-1]+'/'+ref.ano+' · '+(estado?.pendente?'consultando':estado?.erro?'consulta indisponível':estado?.em?'consultado':'aguardando consulta');
        const atualizar=document.getElementById('helAtualizarCalendario');atualizar.disabled=!!estado?.pendente;atualizar.onclick=()=>consultarCalendario(ref.ano,true);
        if(consultar)void consultarCalendario(ref.ano);
    }

    function iniciarRecursosConferencia() {
        const cssButtonColors=document.createElement('style');cssButtonColors.textContent="#hel-app .hel-btn-quick{background:#e8f1fa!important;border-color:#a5bfd8!important;color:#244866!important}#hel-app .hel-btn-quick:hover:not(:disabled){background:#d6e7f7!important;border-color:#658cae!important}#hel-app #helNovaLinha,#hel-app #helAplicarPadrao{background:#287344;border-color:#216139;color:#fff}#hel-app #helNovaLinha:hover:not(:disabled),#hel-app #helAplicarPadrao:hover:not(:disabled){background:#216139}#hel-app #helVerCadastrados{background:#fff;border-color:#2f5d86;color:#244866}#hel-app #helVerCadastrados:hover:not(:disabled){background:#edf4fa}#hel-app #helNovoLote{background:#f1f2f3;border-color:#b4bac0;color:#46515c}#hel-app #helNovoLote:hover:not(:disabled){background:#e1e4e7}#hel-app #helLimpar{background:#b33232;border-color:#a32828;color:#fff}#hel-app #helLimpar:hover:not(:disabled){background:#942727}#hel-app #helConsultarExistentes,#hel-app #helAtualizarCalendario{background:#c25706;border-color:#ae4d05;color:#fff}#hel-app #helConsultarExistentes:hover:not(:disabled),#hel-app #helAtualizarCalendario:hover:not(:disabled){background:#ae4d05}#hel-app .hel-btn:focus-visible{outline:2px solid #244866;outline-offset:3px}";document.head.appendChild(cssButtonColors);
        inserirCreditosHE(app);
        const cssPeriodo=document.createElement('style');cssPeriodo.textContent='#hel-app .hel-periodo-heading{display:flex;align-items:center;justify-content:flex-start;gap:8px;min-height:14px}#hel-app .hel-periodo-heading label{margin:0;line-height:14px}#hel-app .hel-periodo-toggle{display:flex;align-items:center;gap:5px;font-size:12px;font-weight:400;white-space:nowrap;color:#333}#hel-app .hel-periodo-toggle input{width:13px;height:13px!important;margin:0;flex:none}';document.head.appendChild(cssPeriodo);
        iniciarPendenciasHE();
        iniciarOpcaoFeriados();
        iniciarExclusaoDrawer();
        iniciarCamposHorario();
        const toolbar=app.querySelector('.hel-day-toolbar > div');
        const button=document.createElement('button');button.type='button';button.id='helVerificarSistema';button.className='hel-btn';button.textContent='Verificar no sistema';button.hidden=true;button.onclick=()=>verificarResultados(false);toolbar.appendChild(button);
        const comp=document.createElement('section');comp.id='helComparacao';comp.hidden=true;
        document.querySelector('#helConsultaDrawer .hel-drawer-body').prepend(comp);
        const cal=document.createElement('details');cal.className='hel-note';cal.style.marginTop='8px';
        cal.innerHTML='<summary id="helCalendarioTitulo">Feriados</summary><div id="helCalendarioLista"></div>';
        const cssCalendarPanel=document.createElement('style');cssCalendarPanel.textContent="#helCalendarioLista{margin-top:8px;padding:10px 12px;border:1px solid #d4dce3;border-radius:3px;font-size:12px;line-height:1.5}.hel-calendar-toolbar{display:flex;justify-content:space-between;align-items:center;gap:12px;padding-bottom:8px}.hel-calendar-toolbar strong{color:#344b5e;font-size:13px}.hel-calendar-toolbar p{margin:3px 0 0;color:#59666f}.hel-calendar-toolbar button{flex:none;min-height:30px}.hel-calendar-dates>div,.hel-calendar-points>div{display:grid;grid-template-columns:85px minmax(0,1fr);gap:10px;padding:7px 0;border-top:1px solid #e4e9ef}.hel-calendar-dates time,.hel-calendar-points time{color:#465866}.hel-calendar-dates span{font-weight:600;color:#344b5e}.hel-calendar-guidance{border-top:1px solid #d4dce3;padding-top:8px;margin-top:4px;color:#59666f}.hel-calendar-guidance p{margin:0 0 3px}.hel-calendar-empty{margin:4px 0 8px}.hel-calendar-points{margin-top:8px}.hel-calendar-points>strong{display:block;margin-bottom:5px}@media(max-width:500px){.hel-calendar-toolbar{align-items:flex-start}#helCalendarioLista{padding:9px}.hel-calendar-toolbar button{padding:5px 8px}}";document.head.appendChild(cssCalendarPanel);
        document.getElementById('helRegraCalculo').parentElement.appendChild(cal);
        window.addEventListener('focus',()=>consultarCalendario(mesAnoHoras().ano));
        setInterval(()=>{if(!document.hidden)void consultarCalendario(mesAnoHoras().ano);},900000);
        const css=document.createElement('style');css.textContent=`
            .hel-comparar { border:1px solid #b8c9d9; border-radius:3px; background:white; color:#2f5d86; cursor:pointer; padding:3px 6px; margin:0; display:inline-block; flex-shrink:0; font-size:11px; }
            .hel-status-content { display:inline-flex; align-items:center; gap:7px; flex-wrap:nowrap; }
            .hel-status-text { white-space:nowrap; max-width:240px; overflow:hidden; text-overflow:ellipsis; }
            .hel-comparison-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:10px 0; }
            .hel-comparison-grid > div { background:#f4f7fa; border:1px solid #d3dce5; padding:9px; font-size:12px; line-height:1.7; }
            .hel-comparison-grid h3 { font-size:13px; margin:0 0 5px; }
            .hel-comparison-time { font-weight:bold; margin:5px 0; }
            #helComparacao { border-bottom:2px solid #d3dce5; padding-bottom:12px; margin-bottom:12px; font-size:12px; }
            #helComparacao[hidden] { display:none; }
            #helComparacao h2 { font-size:15px; margin:0; }
            .hel-post-divergent { background:#fff5e8; }
            #helCalendarioLista { line-height:1.8; padding-top:6px; }
            .hel-status-content { max-width:100%; min-width:0; }
            .hel-status-text { flex-shrink:1; }
            .hel-calendar-warning { display:inline-block; min-width:0; max-width:235px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex-shrink:1; }
            .hel-modal { font:13px Arial,sans-serif; border-radius:6px; overflow:hidden; }
            .hel-modal-overlay { padding:16px; }
            .hel-modal { margin:16px auto; }
            .hel-modal-human { display:flex; align-items:center; justify-content:space-between; gap:12px; font-size:15px; }
            .hel-modal-human strong { font-size:24px; }
            #helModalOutrosAvisos { padding:0; border:0; background:transparent; color:#334155; font-weight:400; display:grid; gap:7px; }
            .hel-review-block { border:1px solid #d6dfe7; border-radius:4px; background:#f8fafc; margin-top:7px; }
            .hel-review-block summary { padding:10px; cursor:pointer; font-weight:600; }
            .hel-review-block > div { padding:0 10px 10px; line-height:1.6; }
            .hel-review-block p { margin:7px 0 0; font-size:12px; color:#526273; }
            .hel-review-attention { background:#fffaf0; border-color:#e7d3a5; }
            .hel-review-date { display:inline-block; padding:3px 6px; margin:3px 4px 0 0; border:1px solid #d6dfe7; border-radius:3px; background:white; font-size:12px; }
            #helModalContagemFinal { font-weight:400; font-size:12px; background:transparent; border:0; padding:8px 0; }
            .hel-modal-check { font-weight:400; font-size:13px; }
        `;document.head.appendChild(css);
        app.addEventListener('click',e=>{const button=e.target.closest('.hel-comparar');if(button)abrirComparacao(button.closest('tr'));});
    }

    function compararRegistro(tr,registro) {
        if(!registro)return {ok:false,horarios:false,horas:false,partes:false};
        const linha=dadosLinha(tr),compat=linhaParaSistema(linha);
        const tecnica=compat.linhaSistema;
        const horarios=!!tecnica && ['entrada','saidaAl','retorno','saida'].every(k=>tecnica[k]===registro[k]);
        const horas=registro.heSegundos===heEsperadaSegundos(linha);
        const partes=tr.dataset.preview!=='1' || (segundosHora(registro.he50)===Number(tr.dataset.seg50 || 0) && segundosHora(registro.he100)===Number(tr.dataset.seg100 || 0));
        return {ok:horarios&&horas&&partes,horarios,horas,partes};
    }
    function abrirComparacao(tr) {
        if(!tr)return;
        if(tr.dataset.contextoTerminal && tr.dataset.contextoTerminal!==chaveConsultaAtual()){mensagem('error','Restaure o servidor e período originais para comparar este resultado.');return;}
        const real=dadosLinha(tr),compat=linhaParaSistema(real);
        const atual=consultaConfirmada&&consultaContexto===chaveConsultaAtual();
        const salvo=tr.dataset.registroVerificado ? JSON.parse(tr.dataset.registroVerificado) : null;
        const registro=atual ? registrosExistentes.get(real.data) : salvo;
        const result=compararRegistro(tr,registro),box=document.getElementById('helComparacao');box.hidden=false;
        box.innerHTML='<h2>Comparação · '+escaparHtml(real.data)+'</h2><div class="hel-comparison-grid"><div><h3>Informado no lote</h3><div class="hel-comparison-time">'+escaparHtml(horarioLinhaTexto(real))+'</div>HE prevista: <strong>'+formatarSegundos(heEsperadaSegundos(real))+'</strong><details><summary>Horário técnico esperado</summary>'+escaparHtml(compat.horarioSistema || 'Horários inválidos')+'</details></div><div><h3>Gravado no sistema</h3>'+(registro?'<div class="hel-comparison-time">'+escaparHtml(horarioLinhaTexto(registro))+'</div>HE registrada: <strong>'+formatarSegundos(registro.heSegundos)+'</strong><div>50%: '+escaparHtml(registro.he50)+'<br>100%: '+escaparHtml(registro.he100)+'</div>':'Nenhum registro encontrado nesta consulta.')+'</div></div><p>'+(!atual?'A consulta atual não foi confirmada. Os dados acima, quando presentes, são da última verificação salva.':!registro?'A ausência neste período não autoriza reenvio automático. Confira também outros períodos.':result.ok?'O registro corresponde aos horários técnicos e à HE esperada.':'Há diferença '+(!result.horarios?'nos horários técnicos ':'')+(!result.horas||!result.partes?'nos valores de HE ':'')+'. Revise pela consulta oficial; nenhuma alteração será feita automaticamente.')+'</p><button type="button" class="hel-btn" id="helFecharComparacao">Fechar comparação</button>';
        document.getElementById('helFecharComparacao').onclick=()=>{box.hidden=true;};
        const drawer=document.getElementById('helConsultaDrawer');if(!drawer.classList.contains('visible'))document.getElementById('helVerCadastrados').click();
        drawer.querySelector('.hel-drawer-body').scrollTop=0;
    }

    function atualizarRecursosConferencia() {
        document.querySelectorAll('.hel-excluir-cadastrado').forEach(b=>b.disabled=processando||consultando||!consultaConfirmada||consultaContexto!==chaveConsultaAtual());
        const b=document.getElementById('helVerificarSistema');if(!b)return;
        const rows=[...document.querySelectorAll('#helLinhas tr')];
        const results=rows.filter(tr=>tr.dataset.incluido==='1'||tr.dataset.incerto==='1');
        b.hidden=!results.length;
        rows.forEach(tr=>{
            const real=dadosLinha(tr);
            if(tr.dataset.conferenciaMensagem && (tr.dataset.incluido==='1'||tr.dataset.incerto==='1')) {
                aplicarStatusLinha(tr,tr.dataset.conferenciaMensagem,tr.dataset.conferenciaConsulta==='conferido'?'hel-ok':'hel-warning');
                tr.classList.toggle('hel-post-divergent',tr.dataset.conferenciaConsulta==='divergente');
            }
            const registro=consultaConfirmada&&consultaContexto===chaveConsultaAtual()?registrosExistentes.get(real.data):null;
            const terminal=tr.dataset.incluido==='1'||tr.dataset.incerto==='1';
            if ((registro&&!compararRegistro(tr,registro).ok)||terminal) {
                let button=tr.querySelector('.hel-comparar');
                if(!button){button=document.createElement('button');button.type='button';button.className='hel-comparar';button.textContent='Comparar';(tr.querySelector('.hel-status-content') || tr.querySelector('.hel-status')).appendChild(button);}
                button.disabled=processando||consultando;
            }
            tr.querySelector('.hel-calendar-warning')?.remove();
            const aviso=avisoCalendario(real.data);
            if(aviso){const tag=document.createElement('span');tag.className='hel-calendar-warning';tag.textContent=' · '+rotuloCalendario(real.data);tag.title=aviso+' — confira expediente e autorização; somente aviso';tag.style.cssText='color:#8a5800;font-size:11px';(tr.querySelector('.hel-status-content')||tr.querySelector('.hel-status')).appendChild(tag);}
        });
    }

    async function aplicarConferenciaConsulta(automatico) {
        if(!consultaConfirmada || consultaContexto!==chaveConsultaAtual())return;
        const rows=[...document.querySelectorAll('#helLinhas tr')].filter(tr=>tr.dataset.incluido==='1'||tr.dataset.incerto==='1');
        for(const tr of rows) {
            if(tr.dataset.contextoTerminal!==chaveConsultaAtual())continue;
            const data=dadosLinha(tr).data,registro=registrosExistentes.get(data),result=compararRegistro(tr,registro);
            const jaConferido=tr.dataset.conferenciaConsulta==='conferido';
            const eraIncerto=tr.dataset.incerto==='1';
            tr.dataset.conferenciaConsulta=result.ok?'conferido':registro?'divergente':'ausente';
            tr.dataset.registroVerificado=JSON.stringify(registro||null);
            tr.dataset.conferenciaMensagem=result.ok?(MODO_SIMULACAO?'Simulado e conferido':'Incluído e conferido'):registro?'Registro encontrado com divergência — revisar':'Não localizado neste período — conferir';
            if(result.ok){const op=lerOperacaoHE(infoServidor().rf,data);if(op&&op.periodo.nome===periodoSelecionado().nome&&String(op.periodo.ano)===String(periodoSelecionado().ano)&&operacaoConfereRegistro(op,registro))concluirOperacaoHE(op,'confirmada-pela-consulta');}
            if(result.ok&&!jaConferido)notificarOperacaoHE('cadastro',data,{nome:infoServidor()?.nome||registro.nome,grupo:chaveConsultaAtual(),segundos:segundosHora(registro.he50)+segundosHora(registro.he100)});
            if(result.ok && eraIncerto) {
                delete tr.dataset.incerto;tr.classList.remove('hel-uncertain');tr.dataset.incluido='1';
                const item=auditoria.slice().reverse().find(a=>a.data===data&&a.incerto);
                if(item){item.ok=true;item.incerto=false;item.resultado='Incluído e conferido';item.observacao+=' Registro localizado pela consulta; nenhuma nova inclusão foi enviada.';}
            }
            const item=auditoria.slice().reverse().find(a=>a.data===data);
            if(item){item.conferenciaConsulta=tr.dataset.conferenciaConsulta;item.registroVerificado=registro||null;item.conferidoEm=new Date().toISOString();if(result.ok)item.resultado=MODO_SIMULACAO?'Simulado e conferido':'Incluído e conferido';else {if(item.ok)item.resultado='Incluído — '+(registro?'divergência na consulta':'não localizado na consulta');item.observacao=(item.observacao||'').replace(/ \[Consulta:.*?\]/g,'')+' [Consulta: '+tr.dataset.conferenciaMensagem+']';}}
        }
        renderAuditoria();atualizarResumo();salvarRascunho();
        if(rows.length){
            const ok=rows.filter(tr=>tr.dataset.conferenciaConsulta==='conferido').length;
            const divergentes=rows.filter(tr=>tr.dataset.conferenciaConsulta==='divergente').length;
            const ausentes=rows.filter(tr=>tr.dataset.conferenciaConsulta==='ausente').length;
            mensagem(ok===rows.length?'success':'warning','Conferência '+(automatico?'após envio':'pela consulta')+': '+ok+' conferido(s) · '+divergentes+' divergente(s) · '+ausentes+' não localizado(s).'+(ausentes?' Não reenvie automaticamente; confira outros períodos.':''));
        }
    }

    async function verificarResultados(automatico=false) {
        if(!automatico&&(processando||consultando))return false;
        const chave=chaveConsultaAtual();
        if(!chave)return false;
        const rows=[...document.querySelectorAll('#helLinhas tr')].filter(tr=>tr.dataset.incluido==='1'||tr.dataset.incerto==='1');
        if(rows.some(tr=>tr.dataset.contextoTerminal!==chave)) {mensagem('error','Este resultado pertence a outro servidor ou período. Restaure o contexto original antes de verificar.');return false;}
        consultando=true;setBloqueado(true);
        try {
            const mapa=await obterExistentes(infoServidor(),periodoSelecionado());
            if(chave!==chaveConsultaAtual())throw Error('Contexto alterado durante a verificação');
            registrosExistentes=mapa;consultaContexto=chave;consultaConfirmada=true;
            document.getElementById('helConsultaStatus').textContent=mapa.size+' dia(s) cadastrado(s) · verificado às '+new Date().toLocaleTimeString('pt-BR')+'.';
            renderExistentes();await aplicarConferenciaConsulta(automatico);return true;
        } catch(erro) {
            consultaConfirmada=false;
            rows.forEach(tr=>{tr.dataset.conferenciaConsulta='pendente';tr.dataset.conferenciaMensagem='Conferência pendente — consulta indisponível';const item=auditoria.slice().reverse().find(a=>a.data===dadosLinha(tr).data);if(item){item.conferenciaConsulta='pendente';item.observacao=(item.observacao||'').replace(/ \[Consulta:.*?\]/g,'')+' [Consulta: indisponível na última tentativa]';}});
            renderAuditoria();
            document.getElementById('helConsultaStatus').textContent='Verificação não confirmada: '+erro.message;
            mensagem('warning','A consulta não confirmou os resultados. Use Verificar no sistema novamente. Nenhuma data foi reenviada.');
            salvarRascunho();return false;
        } finally {consultando=false;if(!processando)setBloqueado(false);atualizarResumo();}
    }


    let exclusaoDrawer = null;
    const EXCLUSOES_KEY = 'pg_he_exclusoes_confirmadas_v46';
    const exclusoesPainel = [];
    function assinaturaRegistroExistente(r) {
        return r ? JSON.stringify([r.data,r.nome||'',r.entrada,r.saidaAl,r.retorno,r.saida,r.he50,r.he100,r.heSegundos,segundosHora(r.adNoturno||'00:00')]) : '';
    }
    function iniciarExclusaoDrawer() {
        const modal=document.createElement('div');modal.id='helExcluirDrawerModal';modal.className='hel-modal-overlay';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','helExcluirDrawerTitulo');
        modal.innerHTML='<div class="hel-modal"><div class="hel-modal-head" id="helExcluirDrawerTitulo">Deseja realmente excluir este dia?</div><div class="hel-modal-body"><div id="helExcluirDrawerDados" class="hel-modal-grid"></div><p>O lançamento será removido do sistema. Para corrigir os horários, cadastre o dia novamente após a exclusão.</p><p id="helExcluirDrawerStatus" role="status"></p></div><div class="hel-modal-actions"><button type="button" class="hel-btn" id="helExcluirDrawerCancelar">Cancelar</button><button type="button" class="hel-btn" id="helExcluirDrawerConfirmar" style="background:#a32929;color:white;border-color:#a32929">'+(MODO_SIMULACAO?'Excluir da simulação':'Excluir lançamento')+'</button></div></div>';
        document.body.appendChild(modal);
        document.getElementById('helExistentesLista').addEventListener('click',e=>{const b=e.target.closest('.hel-excluir-cadastrado');if(!b||processando||consultando)return;
            const r=registrosExistentes.get(b.dataset.data),info=infoServidor(),p=periodoSelecionado();
            if(!r||!info||!consultaConfirmada||consultaContexto!==chaveConsultaAtual()){mensagem('warning','Atualize a consulta antes de excluir.');return;}
            exclusaoDrawer={r:{...r},info:{...info},p:{...p},chave:chaveConsultaAtual()};
            const item=(label,value)=>'<div class="hel-modal-item"><span>'+label+'</span><strong>'+escaparHtml(value)+'</strong></div>';
            document.getElementById('helExcluirDrawerDados').innerHTML=item('Servidor',r.nome||info.nome)+item('RF',info.rf)+item('Data',r.data)+item('Folha',p.nome+'/'+p.ano)+item('Horários gravados',horarioLinhaTexto(r))+item('Horas extras',formatarSegundos(r.heSegundos))+(segundosHora(r.adNoturno||'00:00')?item('Adicional noturno',r.adNoturno):'');
            document.getElementById('helExcluirDrawerStatus').textContent='';document.getElementById('helExcluirDrawerConfirmar').disabled=false;
            modal.classList.add('visible');document.getElementById('helExcluirDrawerCancelar').focus();
        });
        const fechar=()=>{if(processando)return;modal.classList.remove('visible');exclusaoDrawer=null;};
        document.getElementById('helExcluirDrawerCancelar').onclick=fechar;
        modal.addEventListener('click',e=>{if(e.target===modal)fechar();});
        document.addEventListener('keydown',e=>{if(e.key==='Escape'&&modal.classList.contains('visible'))fechar();});
        document.getElementById('helExcluirDrawerConfirmar').onclick=excluirPeloDrawer;
    }
    async function excluirPeloDrawer() {try{return await executarOperacaoExclusivaHE(()=>excluirPeloDrawerProtegido());}catch(e){document.getElementById('helExcluirDrawerStatus').textContent=e.message;}}
    async function excluirPeloDrawerProtegido() {
        if(processando||consultando||!exclusaoDrawer)return;
        const escolha=exclusaoDrawer,modal=document.getElementById('helExcluirDrawerModal'),status=document.getElementById('helExcluirDrawerStatus');
        if(escolha.chave!==chaveConsultaAtual()){status.textContent='O servidor ou período mudou. Feche e consulte novamente.';document.getElementById('helExcluirDrawerConfirmar').disabled=true;return;}
        processando=true;setBloqueado(true);document.getElementById('helExcluirDrawerConfirmar').disabled=true;document.getElementById('helExcluirDrawerCancelar').disabled=true;
        status.textContent='Conferindo o lançamento antes de excluir…';let tentouExcluir=false,operacaoExclusao;
        try {
            const fresco=await obterExistentes(escolha.info,escolha.p,true),atual=fresco.mapa.get(escolha.r.data);
            if(escolha.chave!==chaveConsultaAtual())throw Error('O servidor ou período mudou. Consulte novamente.');
            if(!atual)throw Error('Esse dia já não aparece na consulta. Atualize a lista.');
            if(assinaturaRegistroExistente(atual)!==assinaturaRegistroExistente(escolha.r))throw Error('O lançamento mudou desde a confirmação. Atualize a lista e confira os novos dados.');
            let params;
            if(!MODO_SIMULACAO){
                const f=fresco.doc.querySelector('#form1'),botao=fresco.doc.querySelector('#btnExcluir');
                if(!botao||botao.disabled||!f.querySelector('#TextBox2')||f.querySelector('#TextBox2').disabled)throw Error('A consulta não disponibilizou o comando de exclusão.');
                params=new URLSearchParams(new FormData(f));params.delete('Button1');params.delete('btnLimpar');params.delete('btnExcluir');
                params.set('__EVENTTARGET','');params.set('__EVENTARGUMENT','');params.set('TextBox1',normalizarRF(escolha.info.rf));params.set('DropDownList1',escolha.p.nome);params.set('anoPeriodo',String(escolha.p.ano));params.set('TextBox2',escolha.r.data);params.set('btnExcluir',botao.value||'Excluir');
            }
            operacaoExclusao=registrarExclusaoHE(escolha.info,escolha.p,escolha.r);
            status.textContent='Excluindo e conferindo o resultado…';tentouExcluir=true;consultaConfirmada=false;
            try {
                if(MODO_SIMULACAO){
                    if(window.__HEL_SIM_EXCLUSAO__==='falha-sem-excluir')throw Error('Falha simulada');
                    const base=lerBaseSimulada().filter(r=>!(normalizarRF(r.rf)===normalizarRF(escolha.info.rf)&&r.periodo===escolha.p.nome&&String(r.ano)===String(escolha.p.ano)&&r.data===escolha.r.data));
                    localStorage.setItem('pg_he_beta45_sim_base',JSON.stringify(base));
                    if(window.__HEL_SIM_EXCLUSAO__==='falha-apos-excluir')throw Error('Resposta perdida');
                }else await buscarPaginaConsulta(fresco.action,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},body:params.toString()});
            }catch(e){/* Reconcile once, without sending another deletion. */}
            const mapa=await obterExistentes(escolha.info,escolha.p);
            if(escolha.chave!==chaveConsultaAtual())throw Error('O servidor ou período mudou durante a verificação.');
            registrosExistentes=mapa;consultaContexto=escolha.chave;consultaConfirmada=true;renderExistentes();
            if(mapa.has(escolha.r.data))throw Error('O dia ainda aparece na consulta. A exclusão não foi confirmada; nenhum novo pedido foi enviado.');
            document.querySelectorAll('#helLinhas tr').forEach(tr=>{
                if(dadosLinha(tr).data!==escolha.r.data || (tr.dataset.contextoTerminal&&tr.dataset.contextoTerminal!==escolha.chave))return;
                if(tr.dataset.incluido==='1'||tr.dataset.incerto==='1'){tr.remove();return;}
                delete tr.dataset.preExistia;delete tr.dataset.jaExistia;delete tr.dataset.contextoTerminal;invalidarPreviaLinha(tr);
            });
            const eventoExclusao={excluidoEm:new Date().toISOString(),rf:escolha.info.rf,periodo:escolha.p,registro:escolha.r,simulacao:MODO_SIMULACAO};
            try {concluirExclusaoHE(operacaoExclusao);} catch(e){exclusoesPainel.push(eventoExclusao);informarArmazenamento('O dia não aparece, mas a recuperação do histórico continua pendente.',true);throw Error('O dia não aparece na consulta, mas o histórico não pôde ser concluído. Use Verificar exclusões pendentes; não repita a exclusão.');}
            mostrarAvisosEntrada([]);document.getElementById('helConsultaStatus').textContent=mapa.size+' dia(s) cadastrado(s) · exclusão conferida.';
            status.textContent='Dia '+escolha.r.data+' excluído. Você já pode cadastrar novamente.';
            mensagem('success',status.textContent);modal.classList.remove('visible');exclusaoDrawer=null;salvarRascunho();
        }catch(e){
            status.textContent=(tentouExcluir&&!consultaConfirmada?'Não foi possível confirmar a exclusão. Atualize a consulta antes de tentar novamente. ':'')+e.message;
            mensagem('warning',status.textContent);
        }finally{processando=false;setBloqueado(false);document.getElementById('helExcluirDrawerCancelar').disabled=false;atualizarResumo();}
    }


    let armazenamentoFalhou = false;
    function informarArmazenamento(texto,erro=false) {
        armazenamentoFalhou = erro;
        let box=document.getElementById('helStorageStatus');
        if(!box){box=document.createElement('div');box.id='helStorageStatus';box.setAttribute('role','status');box.style.cssText='font-size:12px;margin-top:6px';document.getElementById('helDraftBox').appendChild(box);}
        box.textContent=texto;box.style.color=erro?'#a32929':'#526273';
        if(erro)document.getElementById('helDraftBox').classList.remove('hidden');
    }
    function iniciarCamposHorario() {
        const seletor='.hel-hora,#helPadEntrada,#helPadSaidaAl,#helPadRetorno,#helPadSaida';
        const configurar=()=>app.querySelectorAll(seletor).forEach(el=>{el.inputMode='numeric';el.maxLength=5;el.placeholder='HH:MM';el.setAttribute('pattern','([01][0-9]|2[0-3]):[0-5][0-9]');el.title='Horário de 00:00 a 23:59. Digite 9 para 09:00 ou 9:30 para 09:30. Minutos de 00 a 59.';});
        configurar();new MutationObserver(configurar).observe(document.getElementById('helLinhas'),{childList:true,subtree:true});
        const selecionarHorario=e=>{const el=e.target;if(el.matches(seletor)&&!el.disabled&&!el.readOnly)el.select();};
        app.addEventListener('focusin',selecionarHorario);
        app.addEventListener('click',selecionarHorario);
        const validar=el=>{const invalido=el.value!==''&&!horaValida(el.value);el.setAttribute('aria-invalid',String(invalido));el.style.outline=invalido?'1px solid #b3261e':'';el.setCustomValidity(invalido?'Informe HH:MM. Hora de 00 a 23; minutos de 00 a 59.':'');};
        const aviso=()=>mensagem('warning','Informe um horário, por exemplo 08:30. Use hora de 00 a 23 e minutos de 00 a 59; não digite texto nem uma duração como “80 min”.');
        app.addEventListener('beforeinput',e=>{if(e.target.matches(seletor)&&e.data&&/[^0-9:]/.test(e.data)){e.preventDefault();aviso();}});
        app.addEventListener('paste',e=>{if(!e.target.matches(seletor))return;const t=e.clipboardData.getData('text').trim();if(!/^(?:\d{1,2}|\d{1,2}:\d{2}|\d{4})$/.test(t)){e.preventDefault();aviso();}});
        app.addEventListener('input',e=>{if(e.target.matches(seletor))validar(e.target);},true);
        app.addEventListener('blur',e=>{
            if(!e.target.matches(seletor))return;const el=e.target,v=el.value.trim();let novo=v;
            if(/^\d{1,2}$/.test(v))novo=v.padStart(2,'0')+':00';else if(/^\d{4}$/.test(v))novo=v.slice(0,2)+':'+v.slice(2);else if(/^\d:\d{2}$/.test(v))novo='0'+v;
            if(horaValida(novo)&&novo!==el.value){el.value=novo;el.dispatchEvent(new Event('input',{bubbles:true}));}
            validar(el);if(el.value&&!horaValida(el.value))aviso();
        },true);
        document.getElementById('helMensagem').setAttribute('role','status');
        // Keep keyboard focus in the active confirmation and return to its trigger.
        const triggers=new Map();let anterior=document.activeElement;
        document.addEventListener('focusin',e=>{if(!e.target.closest('.hel-modal-overlay'))anterior=e.target;});
        document.querySelectorAll('.hel-modal-overlay').forEach(modal=>{
            modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');
            new MutationObserver(()=>{if(modal.classList.contains('visible'))triggers.set(modal,anterior);else {const t=triggers.get(modal);if(t?.isConnected&&!t.disabled)t.focus();}}).observe(modal,{attributes:true,attributeFilter:['class']});
        });
        document.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const modal=[...document.querySelectorAll('.hel-modal-overlay.visible')].pop();if(!modal)return;
            const els=[...modal.querySelectorAll('button,input,select,a[href],summary')].filter(el=>!el.disabled&&el.getClientRects().length);if(!els.length)return;
            const primeiro=els[0],ultimo=els[els.length-1];if(!modal.contains(document.activeElement)||(e.shiftKey&&document.activeElement===primeiro)||(!e.shiftKey&&document.activeElement===ultimo)){e.preventDefault();(e.shiftKey?ultimo:primeiro).focus();}
        });
    }


    function normalizarRF(rf) { return String(rf || '').trim().replace(/^0+(?=\d)/, ''); }
    function linhaJaCadastrada(tr) { return tr.dataset.jaExistia === '1' || tr.dataset.preExistia === '1'; }
    function chaveConsultaAtual() {
        const info = infoServidor(), p = periodoSelecionado(), h = mesAnoHoras();
        if (validarServidor() || !p.mes || !p.ano || erroPeriodoCronologico()) return '';
        return [normalizarRF(info.rf), p.nome, p.ano, h.mes, h.ano].join('|');
    }

    function limparMarcacoesPrevias() {
        document.querySelectorAll('#helLinhas tr').forEach(tr => {
            if (tr.dataset.preExistia !== '1') return;
            delete tr.dataset.preExistia;
            if (tr.dataset.incluido === '1' || tr.dataset.incerto === '1' || tr.dataset.jaExistia === '1') return;
            tr.querySelectorAll('input,button').forEach(el => el.disabled = processando || consultando);
            aplicarStatusLinha(tr, tr.dataset.preview === '1' ? 'Conferido — verificar cadastro' : 'Aguardando');
        });
    }

    function observarContextoConsulta() {
        const chave = chaveConsultaAtual();
        if (chave === contextoObservado) return;
        contextoObservado = chave;
        consultaConfirmada = false;
        registrosExistentes = new Map();
        limparMarcacoesPrevias();
        // A result checked for one RF/period cannot authorize a different context.
        document.querySelectorAll('#helLinhas tr').forEach(tr => {
            if (tr.dataset.incluido === '1' || tr.dataset.incerto === '1' || tr.dataset.jaExistia === '1') return;
            if (tr.dataset.preview === '1') {
                tr.dataset.alteradaAposConferencia = '1';
                tr.classList.add('hel-dirty');
                aplicarStatusLinha(tr, 'Servidor ou período alterado — calcular novamente', 'hel-warning');
            }
            ['preview','seg50','seg100','total','ajusteHorario','horarioSistema','assinatura'].forEach(k => delete tr.dataset[k]);
            ['.hel-he50','.hel-he100','.hel-total','.hel-carga-tecnica'].forEach(sel => tr.querySelector(sel).textContent = '-');
        });
        document.getElementById('helExistentesLista').innerHTML = '';
        document.getElementById('helExistentesResumo').textContent = 'Dias já cadastrados';
        document.getElementById('helConsultaStatus').textContent = chave
            ? 'Consultando os dias cadastrados deste servidor e período…'
            : 'Selecione o servidor e um período válido para consultar.';
        clearTimeout(timerConsulta);
        if (chave) timerConsulta = setTimeout(() => atualizarExistentes(), 650);
    }

    function lerBaseSimulada() {
        const base = JSON.parse(localStorage.getItem('pg_he_beta45_sim_base') || '[]');
        if (!Array.isArray(base)) throw new Error('Base simulada inválida');
        return base;
    }

    async function buscarPaginaConsulta(url, options = {}) {
        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), 20000);
        try {
            const res = await fetch(url, { ...options, credentials: 'same-origin', signal: abort.signal });
            if (!res.ok) throw new Error('Erro HTTP ' + res.status + ' na consulta');
            if (res.url && new URL(res.url).pathname.toLowerCase() !== new URL(url).pathname.toLowerCase()) {
                throw new Error('A consulta foi redirecionada. Confira a sessão.');
            }
            const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
            const f = doc.querySelector('#form1');
            if (!f || !doc.querySelector('#TextBox1') || !doc.querySelector('#Button1') ||
                !f.querySelector('input[name="__VIEWSTATE"]')?.value ||
                !f.querySelector('input[name="__EVENTVALIDATION"]')?.value) {
                throw new Error('A consulta não retornou o formulário esperado. A sessão pode ter expirado.');
            }
            return doc;
        } finally { clearTimeout(timer); }
    }

    function extrairExistentes(doc, info, periodo) {
        if (normalizarRF(doc.querySelector('#TextBox1')?.value) !== normalizarRF(info.rf) ||
            doc.querySelector('#DropDownList1')?.value !== periodo.nome ||
            doc.querySelector('#anoPeriodo')?.value !== String(periodo.ano)) {
            throw new Error('O resultado da consulta pertence a outro servidor ou período.');
        }
        const grid = doc.querySelector('#GridView1');
        const parseHora = texto => {
            if (!duracaoRetornadaValida(texto)) {
                throw new Error('Formato de HE inesperado na consulta');
            }
            return segundosHora(texto);
        };
        const mapa = new Map();
        if (grid) {
            // Paging could hide registered dates; reject incomplete evidence rather than skip silently.
            if (grid.querySelector('a[href*="Page$"], a[href*="Page%24"]')) throw new Error('A consulta está paginada; confira os dias pela tela oficial.');
            const headers = [...grid.querySelectorAll('th')].map(th => th.textContent.trim().toLowerCase());
            const expected = ['registro','nome','periodo','data','entrada','saidaal','retornoal','saida','he50','he100','adnoturno','usuario'];
            if (headers.length !== expected.length || headers.some((v,i) => v !== expected[i])) {
                throw new Error('A estrutura da tabela de consulta mudou.');
            }
            for (const tr of [...grid.rows].slice(1)) {
                const c = [...tr.cells].map(td => td.textContent.trim());
                if (c.length !== 12) throw new Error('Linha inesperada na consulta');
                if (normalizarRF(c[0]) !== normalizarRF(info.rf) || c[2] !== periodo.nome) throw new Error('Servidor/período divergente na tabela');
                const data = c[3].match(/\b\d{2}\/\d{2}\/\d{4}\b/)?.[0];
                if (!data || !dataValida(data) || mapa.has(data)) throw new Error('Data inválida ou repetida na consulta');
                if(!c.slice(4,8).every(horaValida)||!duracaoRetornadaValida(c[10]))throw Error('Horários ou adicional noturno inválidos na consulta');
                mapa.set(data, { rf: c[0], nome: c[1], data, entrada: c[4], saidaAl: c[5], retorno: c[6], saida: c[7],
                    adNoturno:c[10], usuario:c[11], he50: c[8], he100: c[9], heSegundos: parseHora(c[8]) + parseHora(c[9]) });
            }
        }
        const total = texto => {
            const t = String(texto || '').trim();
            if (/^\d+(?:[.,]\d+)?$/.test(t)) return Math.round(Number(t.replace(',', '.')) * 3600);
            return parseHora(t);
        };
        const l50 = doc.querySelector('#L50'), l100 = doc.querySelector('#L100');
        if (!l50 || !l100) throw new Error('A consulta não trouxe os totais; não é possível confirmar que está completa.');
        const a = [...mapa.values()];
        if (total(l50.textContent) !== a.reduce((sum,r) => sum + parseHora(r.he50),0) ||
            total(l100.textContent) !== a.reduce((sum,r) => sum + parseHora(r.he100),0)) {
            throw new Error('Os totais divergem da tabela. A consulta pode estar incompleta.');
        }
        return mapa;
    }

    async function obterExistentes(info, p, detalhes = false) {
        if (MODO_SIMULACAO) {
            if (window.__HEL_SIM_FALHA_CONSULTA__) throw new Error('Falha de consulta simulada');
            const mapa = new Map(lerBaseSimulada().filter(r => normalizarRF(r.rf) === normalizarRF(info.rf) &&
                r.periodo === p.nome && String(r.ano) === String(p.ano)).map(r => [r.data, r]));
            return detalhes ? {mapa} : mapa;
        }
        const url = new URL('ConsultaRegistro.aspx', location.href).href;
        const inicial = await buscarPaginaConsulta(url);
        const formConsulta = inicial.querySelector('#form1');
        const action = new URL(formConsulta.getAttribute('action') || url, url);
        if (action.origin !== location.origin || action.pathname.toLowerCase() !== new URL(url).pathname.toLowerCase()) {
            throw new Error('Destino de consulta inesperado');
        }
        const mes = inicial.querySelector('#DropDownList1'), ano = inicial.querySelector('#anoPeriodo');
        if (![...mes.options].some(o => o.value === p.nome) || ![...ano.options].some(o => o.value === String(p.ano))) {
            throw new Error('O período escolhido não está disponível na consulta');
        }
        const params = new URLSearchParams(new FormData(formConsulta));
        params.delete('btnExcluir'); params.delete('btnLimpar'); params.delete('Button1');
        params.set('__EVENTTARGET',''); params.set('__EVENTARGUMENT','');
        params.set('TextBox1', normalizarRF(info.rf));
        params.set('DropDownList1',p.nome); params.set('anoPeriodo',String(p.ano)); params.set('TextBox2','');
        params.set('Button1', inicial.querySelector('#Button1').value || 'Consultar');
        const doc = await buscarPaginaConsulta(action.href, { method: 'POST',
            headers: { 'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8' }, body: params.toString() });
        const mapa = extrairExistentes(doc, info, p);
        return detalhes ? {mapa,doc,action:action.href} : mapa;
    }

    function aplicarRegistrosExistentes() {
        const disponivel = consultaConfirmada && consultaContexto === chaveConsultaAtual();
        document.querySelectorAll('#helLinhas tr').forEach(tr => {
            const linha = dadosLinha(tr);
            const previsto = heEsperadaSegundos(linha);
            tr.querySelector('.hel-prevista').textContent = validarHorarios(linha) ? '—' : formatarSegundos(previsto);
            if (tr.dataset.incluido === '1' || tr.dataset.incerto === '1' || tr.dataset.jaExistia === '1') return;
            const existente = disponivel ? registrosExistentes.get(linha.data) : null;
            if (existente) {
                tr.dataset.preExistia = '1';
                tr.querySelectorAll('input,button').forEach(el => el.disabled = true);
                const diferente = existente.heSegundos !== previsto;
                tr.querySelector('.hel-status').title = 'Esta data já está cadastrada e não será enviada. Compare os detalhes se houver diferença.';
                aplicarStatusLinha(tr, 'Já cadastrado: ' + formatarSegundos(existente.heSegundos) +
                    (diferente ? ' · lote: ' + formatarSegundos(previsto) : ''), 'hel-warning');
            } else if (tr.dataset.preExistia === '1') {
                delete tr.dataset.preExistia;
                tr.querySelectorAll('input,button').forEach(el => el.disabled = processando || consultando);
                aplicarStatusLinha(tr, tr.dataset.preview === '1' ? 'Conferido' : 'Aguardando');
            }
        });
    }

    function renderExistentes() {
        const a = [...registrosExistentes.values()].sort((a,b) => timestampData(a.data)-timestampData(b.data));
        document.getElementById('helExistentesResumo').textContent = a.length + ' dia(s) já cadastrado(s) no período da folha';
        document.getElementById('helExistentesLista').innerHTML = a.length ? a.map(r =>
            '<div class="hel-existing-card"><div class="hel-existing-head"><strong>' + escaparHtml(r.data) + '</strong><span>' + escaparHtml(formatarSegundos(r.heSegundos)) + ' HE</span><button type="button" class="hel-excluir-cadastrado hel-btn" data-data="' + escaparHtml(r.data) + '" style="padding:3px 7px;color:#9a2929">Excluir</button></div>' +
            '<details><summary>Horários e detalhes</summary><div class="hel-existing-time">' + escaparHtml(horarioLinhaTexto(r)) + '</div><div>HE 50%: ' + escaparHtml(r.he50) + ' · HE 100%: ' + escaparHtml(r.he100) + '</div><small>Horário gravado no sistema</small></details></div>').join('') : '<p>Nenhum lançamento encontrado neste período.</p>';
        document.getElementById('helExistentesDetalhes').open = true;
        atualizarLayoutCompacto();
    }

    async function atualizarExistentes() {
        if (processando) return false;
        if (consultaPromessa) return consultaPromessa;
        const chave = chaveConsultaAtual();
        clearTimeout(timerConsulta);
        if (!chave) { mensagem('error', validarServidor() || 'Selecione um período válido.'); return false; }
        const info = infoServidor(), p = periodoSelecionado();
        consultando = true;
        consultaConfirmada = false;
        setBloqueado(true);
        document.getElementById('helConsultaStatus').textContent = 'Consultando lançamentos existentes…';
        consultaPromessa = (async () => {
            try {
                const mapa = await obterExistentes(info,p);
                if (chave !== chaveConsultaAtual()) throw new Error('Servidor/período alterado durante a consulta');
                registrosExistentes = mapa; consultaContexto = chave; consultaConfirmada = true;
                document.getElementById('helConsultaStatus').textContent = mapa.size + ' dia(s) cadastrado(s) · consulta atualizada às ' + new Date().toLocaleTimeString('pt-BR') + '.';
                renderExistentes();
                await aplicarConferenciaConsulta(false);
                return true;
            } catch (erro) {
                consultaConfirmada = false;
                document.getElementById('helConsultaStatus').textContent = 'Consulta não confirmada: ' + erro.message + '. O envio está bloqueado; tente atualizar novamente.';
                mensagem('error', 'Não foi possível confirmar os dias cadastrados: ' + erro.message);
                return false;
            } finally {
                consultando = false; consultaPromessa = null;
                setBloqueado(false); atualizarResumo();
            }
        })();
        return consultaPromessa;
    }

    function salvarRelatorio() {
        const linhas = [...document.querySelectorAll('#helLinhas tr')].map(tr => {
            const real = dadosLinha(tr), compat = linhaParaSistema(real);
            const cadastrado = consultaConfirmada ? registrosExistentes.get(real.data) : null;
            return { ...real, horarioReal: horarioLinhaTexto(real), horarioTecnico: compat.horarioSistema || '',
                hePrevista: formatarSegundos(heEsperadaSegundos(real)),
                heRetornada: tr.dataset.preview === '1' ? formatarSegundos(Number(tr.dataset.total || 0)) : null,
                registroExistente: cadastrado || null, conferenciaConsulta: tr.dataset.conferenciaConsulta || '', registroVerificado: tr.dataset.registroVerificado ? JSON.parse(tr.dataset.registroVerificado) : null, status: tr.querySelector('.hel-status').textContent };
        });
        const dados = { versao: '4.6.0-beta.18', simulacao: MODO_SIMULACAO, exportadoEm: new Date().toISOString(),
            contextoAtual: metaAuditoriaAtual(), contextoAuditoria: auditoriaMeta, consultaConfirmada,
            contextoConsulta: consultaContexto, recuperacoesRascunhos: listarRecuperacoesHE(infoServidor()?.rf??null), exclusoesPendentes: infoServidor()?listarExclusoesPendentesHE(infoServidor().rf):[], exclusoesPainel: [...lerHistoricoExclusoes(),...exclusoesPainel], inclusoesPendentes: infoServidor()?listarOperacoesHE(infoServidor().rf):[], calendario: { ano: mesAnoHoras().ano, resumo: resumoConsultaCalendario(mesAnoHoras().ano), fonte: 'https://brasilapi.com.br/api/feriados/v1/' + mesAnoHoras().ano, respostaRecebidaEm: consultasCalendario.get(mesAnoHoras().ano)?.em || null, somenteAvisos: !bloquearFeriadosNacionais(), bloquearFeriadosNacionais: bloquearFeriadosNacionais(), referenciasLocaisConferidasEm: '2026-10-04', avisos: linhas.map(l => ({ data: l.data, aviso: avisoCalendario(l.data) })).filter(l => l.aviso) }, linhas, auditoria };
        dados.avisosHistorico=[...avisosHistoricoHE];if(avisosHistoricoHE.length)mensagem('warning','Relatório exportado com os dados válidos. '+avisosHistoricoHE.length+' registro(s) do histórico não puderam ser lidos e foram preservados.');
        const url = URL.createObjectURL(new Blob([JSON.stringify(dados,null,2)], { type: 'application/json;charset=utf-8' }));
        const a = document.createElement('a'); a.href = url;
        a.download = 'Horas_Extras_' + (infoServidor()?.rf || 'lote') + '_' + Date.now() + '.json';
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url),1000);
    }


    function idContextoRascunho(draft = null) {
        const servidor = draft?.servidor ?? txtServidor.value;
        const m = String(servidor || '').trim().match(/^(\d{6})\s+(.+)$/);
        if (!m) return null;
        const mes = Number(draft?.mesHoras ?? mesHorasEl.value);
        const ano = Number(draft?.anoHoras ?? anoHorasEl.value);
        if (!mes || !ano) return null;
        return `${m[1]}:${ano}-${String(mes).padStart(2, '0')}`;
    }

    function chaveRascunho(id) {
        return DRAFT_PREFIX + id;
    }

    function lerIndiceRascunhos() {
        try {
            const x = JSON.parse(localStorage.getItem(DRAFT_INDEX_KEY) || '[]');
            return Array.isArray(x) ? x : [];
        } catch {
            return [];
        }
    }

    function gravarIndiceRascunhos(indice) {
        try {
            localStorage.setItem(DRAFT_INDEX_KEY, JSON.stringify(indice));
        } catch {}
    }

    function construirRascunho() {
        const linhas = [...document.querySelectorAll('#helLinhas tr')].map(tr => {
            const d = dadosLinha(tr);
            return {
                ...d,
                preview: tr.dataset.preview === '1',
                incluido: tr.dataset.incluido === '1',
                incerto: tr.dataset.incerto === '1',
                contextoTerminal: tr.dataset.contextoTerminal || '',
                conferenciaConsulta: tr.dataset.conferenciaConsulta || '',
                conferenciaMensagem: tr.dataset.conferenciaMensagem || '',
                registroVerificado: tr.dataset.registroVerificado ? JSON.parse(tr.dataset.registroVerificado) : null,
                jaExistia: tr.dataset.jaExistia === '1',
                seg50: Number(tr.dataset.seg50 || 0),
                seg100: Number(tr.dataset.seg100 || 0),
                total: Number(tr.dataset.total || 0),
                ajusteHorario: tr.dataset.ajusteHorario === '1',
                horarioSistema: tr.dataset.horarioSistema || '',
                alteradaAposConferencia: tr.dataset.alteradaAposConferencia === '1'
            };
        });

        return {
            versao: 46,
            salvoEm: new Date().toISOString(),
            servidor: txtServidor.value,
            registro: txtReg.value,
            mesHoras: mesHorasEl.value,
            anoHoras: anoHorasEl.value,
            periodoDiferente: periodoDiferenteEl.checked,
            periodoMes: periodoMesEl.value,
            periodoAno: periodoAnoEl.value,
            padEntrada: valor('helPadEntrada'),
            padSaidaAl: valor('helPadSaidaAl'),
            padRetorno: valor('helPadRetorno'),
            padSaida: valor('helPadSaida'),
            linhas,
            auditoria,
            auditoriaMeta,
            auditoriaEhAnterior
        };
    }

    function salvarRascunho() {
        try {
            const draft = construirRascunho();
            if (!draft.linhas.length) {
                atualizarAvisoRascunho();
                return;
            }
            const id = idContextoRascunho(draft);
            if (!id) {
                atualizarAvisoRascunho();
                return;
            }

            const bloqueio=protegerRascunhoHE(chaveRascunho(id));if(bloqueio){informarArmazenamento(bloqueio,true);return;}
            localStorage.setItem(chaveRascunho(id), JSON.stringify(draft));
            const info = String(draft.servidor).trim().match(/^(\d{6})\s+(.+)$/);
            let indice = lerIndiceRascunhos().filter(x => x.id !== id);
            indice.push({
                id,
                salvoEm: draft.salvoEm,
                rf: info?.[1] || '',
                nome: info?.[2]?.trim() || '',
                mesHoras: Number(draft.mesHoras),
                anoHoras: Number(draft.anoHoras)
            });
            indice.sort((a, b) => String(b.salvoEm).localeCompare(String(a.salvoEm)));
            gravarIndiceRascunhos(indice);
            atualizarAvisoRascunho(id);
            informarArmazenamento('Dados salvos às ' + new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}) + '. A restauração está desativada.');
        } catch (e) {
            console.warn('[HE Lote] Não foi possível salvar rascunho.', e);
            informarArmazenamento('Não foi possível salvar neste navegador. Exporte o relatório antes de fechar a aba.',true);
        }
    }

    function migrarRascunhoLegado() {
        // v4.0 não importa rascunhos antigos: a regra de compatibilidade de horários mudou.
        return;
        try {
            const bruto = localStorage.getItem(LEGACY_DRAFT_KEY);
            if (!bruto) return;
            const draft = JSON.parse(bruto);
            if (!draft || draft.versao !== 3) return;
            const id = idContextoRascunho(draft);
            if (!id) return;
            const novo = { ...draft, versao: 31, auditoriaMeta: null, auditoriaEhAnterior: false };
            if (!localStorage.getItem(chaveRascunho(id))) {
                localStorage.setItem(chaveRascunho(id), JSON.stringify(novo));
                const info = String(draft.servidor || '').trim().match(/^(\d{6})\s+(.+)$/);
                const indice = lerIndiceRascunhos().filter(x => x.id !== id);
                indice.push({
                    id,
                    salvoEm: draft.salvoEm || new Date().toISOString(),
                    rf: info?.[1] || '',
                    nome: info?.[2]?.trim() || '',
                    mesHoras: Number(draft.mesHoras),
                    anoHoras: Number(draft.anoHoras)
                });
                gravarIndiceRascunhos(indice);
            }
            localStorage.removeItem(LEGACY_DRAFT_KEY);
        } catch (e) {
            console.warn('[HE Lote] Falha ao migrar rascunho antigo.', e);
        }
    }

    function atualizarAvisoRascunho(preferido = null) {
        const box = document.getElementById('helDraftBox');
        document.getElementById('helRestaurarRascunho').hidden = true;
        const select = document.getElementById('helDraftSelect');
        let indice = lerIndiceRascunhos().filter(x => {
            try { return !!localStorage.getItem(chaveRascunho(x.id)); } catch { return false; }
        });
        gravarIndiceRascunhos(indice);
        select.innerHTML = '';

        if (!indice.length) {
            box.classList.toggle('hidden', !armazenamentoFalhou);
            return;
        }

        indice.forEach(x => {
            const opt = document.createElement('option');
            opt.value = x.id;
            const mesNome = MESES[(Number(x.mesHoras) || 1) - 1] || '?';
            opt.textContent = `${x.rf} — ${x.nome} · ${mesNome}/${x.anoHoras}`;
            select.appendChild(opt);
        });

        const contexto = preferido || idContextoRascunho();
        if (contexto && indice.some(x => x.id === contexto)) select.value = contexto;
        box.classList.remove('hidden');
    }

    function descartarRascunhoSelecionado() {
        const id = document.getElementById('helDraftSelect').value;
        if (!id) return;
        try {if(protegerRascunhoHE(chaveRascunho(id))){informarArmazenamento('Rascunho antigo preservado. O bloqueio continuará até revisão explícita.',true);return;}localStorage.removeItem(chaveRascunho(id));}catch(e){informarArmazenamento('Não foi possível conferir o rascunho; ele foi preservado.',true);return;}
        gravarIndiceRascunhos(lerIndiceRascunhos().filter(x => x.id !== id));
        atualizarAvisoRascunho();
    }

    function descartarRascunhoAtual() {
        const id = idContextoRascunho();
        if (!id) return;
        try {if(protegerRascunhoHE(chaveRascunho(id))){informarArmazenamento('Rascunho antigo preservado. O bloqueio continuará até revisão explícita.',true);return;}localStorage.removeItem(chaveRascunho(id));}catch(e){informarArmazenamento('Não foi possível conferir o rascunho; ele foi preservado.',true);return;}
        gravarIndiceRascunhos(lerIndiceRascunhos().filter(x => x.id !== id));
        atualizarAvisoRascunho();
    }

    function restaurarRascunho() {
        const id = document.getElementById('helDraftSelect').value;
        if (!id) return;

        let draft;
        try {
            draft = JSON.parse(localStorage.getItem(chaveRascunho(id)) || 'null');
        } catch {
            draft = null;
        }
        if (!draft || draft.versao !== 40) {
            alert('O rascunho não pôde ser restaurado.');
            return;
        }

        if (document.querySelectorAll('#helLinhas tr').length && !confirm('Substituir o lote atual pelo rascunho selecionado?')) return;

        document.getElementById('helLinhas').innerHTML = '';
        txtServidor.value = draft.servidor || '';
        txtReg.value = draft.registro || '';
        mesHorasEl.value = String(draft.mesHoras || mesHorasEl.value);
        anoHorasEl.value = String(draft.anoHoras || anoHorasEl.value);
        periodoDiferenteEl.checked = !!draft.periodoDiferente;
        atualizarPeriodo();

        if (draft.periodoDiferente) {
            periodoMesEl.value = draft.periodoMes || periodoMesEl.value;
            periodoAnoEl.value = String(draft.periodoAno || periodoAnoEl.value);
            atualizarAvisoPeriodo();
        }

        valorSet('helPadEntrada', draft.padEntrada || '07:00');
        valorSet('helPadSaidaAl', draft.padSaidaAl ?? '11:00');
        valorSet('helPadRetorno', draft.padRetorno ?? '11:00');
        valorSet('helPadSaida', draft.padSaida || '15:00');

        (draft.linhas || []).forEach(orig => {
            let l = { ...orig };
            if (!l.incluido && !l.incerto && !l.jaExistia) {
                l.preview = false;
                l.seg50 = 0;
                l.seg100 = 0;
                l.total = 0;
                l.ajusteHorario = false;
                l.horarioSistema = '';
            }
            adicionarLinha(l.data || '', l, { restaurando: true });
        });
        auditoria = Array.isArray(draft.auditoria) ? draft.auditoria : [];
        if (MODO_SIMULACAO && draft.versao < 33) {
            auditoria = auditoria.map(a => a.ok
                ? { ...a, resultado: 'Simulação OK', observacao: 'Registro de simulação anterior; nenhum dado foi enviado.' }
                : a);
        }
        auditoriaMeta = draft.auditoriaMeta || null;
        auditoriaEhAnterior = !!draft.auditoriaEhAnterior;
        renderAuditoria();
        ordenarLinhas();
        revalidarDuplicidades();
        atualizarServidorSelecionado();
        atualizarResumo();
        mensagem('info', 'Rascunho v4.2 restaurado. Revise servidor, período e dias antes de continuar.');
    }

    // ---------------------------------------------------------------------
    // Pré-cálculo
    // ---------------------------------------------------------------------
    async function calcularTodos() {
        if (processando || consultando) return;
        if (!await conferirFeriadosParaAcao()) return;
        if (!await atualizarExistentes()) return;
        const linhas = validarTudo();
        if (!linhas) return;

        const futuras = linhas.filter(tr => tr.dataset.incluido !== '1' && !linhaJaCadastrada(tr) && tr.dataset.dataFutura === '1');
        if (futuras.length) {
            const lista = futuras.map(tr => dadosLinha(tr).data).join(', ');
            const ok = confirm(`ATENÇÃO: há ${futuras.length} data(s) futura(s):\n${lista}\n\nDeseja apenas calcular/conferir mesmo assim?`);
            if (!ok) {
                mensagem('warning', 'Cálculo cancelado para revisão das datas futuras.');
                return;
            }
        }

        iniciarNovoLoteEfetivoSeNecessario();
        const pendentes = linhas.filter(tr => tr.dataset.incluido !== '1' && !linhaJaCadastrada(tr));
        if (!pendentes.length) {
            mensagem('warning', 'Não há lançamentos pendentes para calcular.');
            return;
        }

        processando = true;
        cancelarSolicitado = false;
        setBloqueado(true);
        document.getElementById('helCancelar').disabled = false;

        try {
            let todosCompativeis = true;

            for (let i = 0; i < pendentes.length; i++) {
                if (cancelarSolicitado) {
                    mensagem('warning', 'Cálculo interrompido pelo usuário.');
                    return;
                }

                const tr = pendentes[i];
                const linha = dadosLinha(tr);

                const erroCritico = validarLinhaCritica(linha);
                if (erroCritico) {
                    invalidarPreviaLinha(tr);
                    aplicarStatusLinha(tr, erroCritico, 'hel-error');
                    tr.classList.toggle('hel-weekend-invalid', erroCritico.includes('Fim de semana'));
                    todosCompativeis = false;
                    mensagem('error', `Cálculo bloqueado em ${linha.data}: ${erroCritico}.`);
                    atualizarResumo();
                    continue;
                }

                aplicarStatusLinha(tr, 'Calculando...', 'hel-processing');
                progresso(i, pendentes.length, `Calculando ${linha.data}`);

                let calc;
                try {calc = await calcularComCompatibilidade(linha);}
                catch(e){invalidarPreviaLinha(tr);aplicarStatusLinha(tr,'Cálculo não concluído — tente novamente','hel-error');throw e;}
                const r = calc.ok ? calc.resultado : null;

                if (calc.ok) {
                    tr.dataset.preview = '1';
                    delete tr.dataset.alteradaAposConferencia;
                    tr.classList.remove('hel-dirty');
                    tr.dataset.seg50 = String(r.seg50);
                    tr.dataset.seg100 = String(r.seg100);
                    tr.dataset.total = String(r.total);
                    tr.dataset.ajusteHorario = calc.compat.ajustado ? '1' : '0';
                    tr.dataset.horarioSistema = calc.compat.horarioSistema || '';
                    tr.dataset.assinatura = assinaturaLinha(tr);

                    tr.querySelector('.hel-he50').textContent = formatarSegundos(r.seg50);
                    tr.querySelector('.hel-he100').textContent = formatarSegundos(r.seg100);
                    tr.querySelector('.hel-total').textContent = formatarSegundos(r.total);
                    tr.querySelector('.hel-carga-tecnica').textContent = '-';

                    const avisos = [];

                    if (tr.dataset.horarioDiferente === '1') avisos.push('horário diferente do padrão');
                    if (tr.dataset.dataFutura === '1') avisos.push('data futura');

                    aplicarStatusLinha(
                        tr,
                        avisos.length
                            ? `Conferido · ${avisos.join(' · ')}`
                            : '✓ Conferido',
                        avisos.length ? 'hel-warning' : 'hel-ok'
                    );
                } else {
                    todosCompativeis = false;

                    delete tr.dataset.preview;
                    delete tr.dataset.ajusteHorario;
                    delete tr.dataset.horarioSistema;
                    delete tr.dataset.assinatura;
                    tr.dataset.seg50 = '0';
                    tr.dataset.seg100 = '0';
                    tr.dataset.total = '0';

                    tr.querySelector('.hel-he50').textContent = '—';
                    tr.querySelector('.hel-he100').textContent = '—';
                    tr.querySelector('.hel-total').textContent = '—';
                    tr.querySelector('.hel-carga-tecnica').textContent = '-';

                    const msgServidor = calc.mensagens?.find(Boolean) || '';
                    const status = calc.bloqueado
                        ? calc.erro
                        : (msgServidor
                            ? `Servidor: ${msgServidor}`
                            : (calc.resultado?.retornado
                                ? `Sistema retornou ${formatarSegundos(calc.resultado.total)}; esperado ${formatarSegundos(heEsperadaSegundos(linha))}`
                                : 'Sistema não retornou o cálculo esperado'));

                    aplicarStatusLinha(tr, status, 'hel-error');
                }

                atualizarResumo();
                salvarRascunho();
                await sleep(250);
            }

            progresso(pendentes.length, pendentes.length, 'Cálculo concluído');
            mensagem(
                todosCompativeis ? 'success' : 'warning',
                todosCompativeis
                    ? (MODO_SIMULACAO ? 'Cálculo concluído. Confira as horas e os avisos antes de simular o envio.' : 'Cálculo concluído. Confira as horas e os avisos antes de enviar.')
                    : 'Há lançamento(s) cujo cálculo diverge da HE prevista pelos horários. O envio permanece bloqueado.'
            );
        } catch (erro) {
            console.error(erro);
            mensagem('error', 'Erro durante o cálculo: ' + erro.message);
        } finally {
            processando = false;
            setBloqueado(false);
            atualizarResumo();
            salvarRascunho();
        }
    }

    // ---------------------------------------------------------------------
    // Modal de prévia e envio
    // ---------------------------------------------------------------------
    function atualizarConfirmacaoModal() {
        const precisaExcecao = document.getElementById('helConfirmExcecaoWrap').classList.contains('visible');
        const precisaFuturas = document.getElementById('helConfirmFuturasWrap').classList.contains('visible');
        const precisaCompat = document.getElementById('helConfirmCompatWrap').classList.contains('visible');
        const okExcecao = !precisaExcecao || document.getElementById('helConfirmExcecao').checked;
        const okFuturas = !precisaFuturas || document.getElementById('helConfirmFuturas').checked;
        const okCompat = !precisaCompat || document.getElementById('helConfirmCompat').checked;
        document.getElementById('helModalConfirmar').disabled = !(okExcecao && okFuturas && okCompat);
    }


    function renderCompatibilidadeModal(ajustadas) {
        const box = document.getElementById('helModalCompatResumo');
        if (!ajustadas || !ajustadas.length) {
            box.classList.remove('visible');
            box.innerHTML = '';
            return;
        }

        const grupos = new Map();

        ajustadas.forEach(tr => {
            const real = dadosLinha(tr);
            const sistema = linhaParaSistema(real);
            if (!sistema.ok || !sistema.ajustado) return;

            const chave = `${sistema.horarioInformado}|||${sistema.horarioSistema}`;
            if (!grupos.has(chave)) {
                grupos.set(chave, {
                    informado: sistema.horarioInformado,
                    enviado: sistema.horarioSistema,
                    datas: []
                });
            }
            grupos.get(chave).datas.push(real.data);
        });

        const gruposHtml = [...grupos.values()].map(grupo => {
            const datas = grupo.datas
                .slice()
                .sort((a, b) => timestampData(a) - timestampData(b))
                .map(dataCurta)
                .join(' · ');

            return `
                <div class="hel-compat-group">
                    <div class="hel-compat-row">
                        <span class="hel-compat-label">Horário real</span>
                        <span class="hel-compat-value">${escaparHtml(grupo.informado)}</span>
                    </div>
                    <div class="hel-compat-row">
                        <span class="hel-compat-label">Enviado ao sistema</span>
                        <span class="hel-compat-value technical">${escaparHtml(grupo.enviado)}</span>
                    </div>
                    <div class="hel-compat-row">
                        <span class="hel-compat-label">Datas</span>
                        <span class="hel-compat-value hel-compat-dates">${escaparHtml(datas)}</span>
                    </div>
                </div>
            `;
        }).join('');

        box.innerHTML = `
            <details class="hel-compat-details">
                <summary>
                    <span>Ajuste para cálculo do sistema — ${ajustadas.length} lançamento(s)</span>
                </summary>
                ${gruposHtml}
                <div class="hel-compat-note">
                    O horário real permanece na tela e no relatório exportado. A base do sistema grava os horários técnicos acima.
                </div>
            </details>
        `;
        box.classList.add('visible');
    }

    async function abrirPreviaFinal() {
        if (processando || consultando) return;
        if (!await conferirFeriadosParaAcao()) return;
        if (!await atualizarExistentes()) return;
        const linhas = validarTudo();
        if (!linhas) return;

        const pendentes = linhas.filter(tr => tr.dataset.incluido !== '1' && !linhaJaCadastrada(tr));
        if (!pendentes.length) {
            mensagem('warning', 'Não há lançamentos pendentes.');
            return;
        }

        if (!todosProntosParaEnviar()) {
            mensagem('error', 'Todos os dias pendentes precisam estar calculados com a HE prevista pelos horários antes do envio.');
            atualizarResumo();
            return;
        }

        let total50 = pendentes.reduce((s, tr) => s + Number(tr.dataset.seg50 || 0), 0);
        let total100 = pendentes.reduce((s, tr) => s + Number(tr.dataset.seg100 || 0), 0);
        const h = mesAnoHoras();
        const p = periodoSelecionado();
        const padrao = periodoPadrao();
        const info = infoServidor();
        const horariosDiferentes = pendentes.filter(tr => tr.dataset.horarioDiferente === '1');
        const futuras = pendentes.filter(tr => tr.dataset.dataFutura === '1');

        document.getElementById('helModalServidor').textContent = info?.nome || txtServidor.value.trim();
        document.getElementById('helModalRF').textContent = info?.rf || '-';
        document.getElementById('helModalMesHoras').textContent = `${MESES[h.mes - 1]}/${h.ano}`;
        document.getElementById('helModalPeriodoUsual').textContent = `${padrao.nome}/${padrao.ano}`;
        document.getElementById('helModalPeriodo').textContent = `${p.nome}/${p.ano}`;
        document.getElementById('helModalQtd').textContent = String(pendentes.length);
        document.getElementById('helModal50').textContent = formatarSegundos(total50);
        document.getElementById('helModal100').textContent = formatarSegundos(total100);
        document.getElementById('helModalTotal').textContent = formatarSegundos(total50 + total100);
        const ajustadas = pendentes.filter(tr => tr.dataset.ajusteHorario === '1');
        document.getElementById('helModalCargas').textContent = ajustadas.length
            ? `${ajustadas.length} lançamento(s) com ajuste`
            : 'Sem ajustes';
        document.getElementById('helModalHumano').textContent = `${pendentes.length} dia(s) · HE prevista: ${formatarHorasHumanas(pendentes.reduce((sum, tr) => sum + heEsperadaSegundos(dadosLinha(tr)), 0))}`;

        const diasUteisSelecionados = linhas.filter(tr => {
            const data = dadosLinha(tr).data;
            return dataValida(data) && !diaSemanaEhFimDeSemana(data);
        }).length;
        const jaCadastradosConhecidos = linhas.filter(tr => linhaJaCadastrada(tr)).length;
        const jaIncluidosNesteLote = linhas.filter(tr => tr.dataset.incluido === '1').length;
        const aEnviarAgora = pendentes.length;

        let textoContagem = `Você selecionou ${diasUteisSelecionados} dia(s) útil(eis); ${aEnviarAgora} serão enviados`;
        if (jaCadastradosConhecidos) {
            textoContagem += `; ${jaCadastradosConhecidos} já estavam cadastrados`;
        }
        if (jaIncluidosNesteLote) {
            textoContagem += `; ${jaIncluidosNesteLote} já foram incluídos neste lote`;
        }
        textoContagem += '.';

        const observacaoContagem = jaCadastradosConhecidos
            ? 'Os dias já identificados pelo sistema como cadastrados não serão reenviados.'
            : 'Se o sistema identificar uma data já cadastrada durante o processamento, essa linha será marcada e os demais dias continuarão normalmente.';

        document.getElementById('helModalContagemFinal').innerHTML =
            `${escaparHtml(textoContagem)}<span class="hel-count-secondary">${escaparHtml(observacaoContagem)}</span>`;

        const excecao = document.getElementById('helModalExcecao');
        const wrapExcecao = document.getElementById('helConfirmExcecaoWrap');
        const checkExcecao = document.getElementById('helConfirmExcecao');
        checkExcecao.checked = false;
        if (periodoEhExcepcional()) {
            excecao.style.display = '';
            excecao.textContent = `Horas de ${MESES[h.mes - 1]}/${h.ano} serão lançadas em ${p.nome}/${p.ano}. Período usual: ${padrao.nome}/${padrao.ano}.`;
            wrapExcecao.classList.add('visible');
        } else {
            excecao.style.display = 'none';
            excecao.textContent = '';
            wrapExcecao.classList.remove('visible');
        }

        renderAvisosModal(pendentes,horariosDiferentes,futuras);

        renderCompatibilidadeModal(ajustadas);

        const wrapFuturas = document.getElementById('helConfirmFuturasWrap');
        const checkFuturas = document.getElementById('helConfirmFuturas');
        checkFuturas.checked = false;
        wrapFuturas.classList.toggle('visible', futuras.length > 0);

        const wrapCompat = document.getElementById('helConfirmCompatWrap');
        const checkCompat = document.getElementById('helConfirmCompat');
        checkCompat.checked = false;
        wrapCompat.classList.toggle('visible', ajustadas.length > 0);

        document.getElementById('helModalConfirmar').disabled = false;
        atualizarConfirmacaoModal();
        document.getElementById('helModalHumano').innerHTML = '<span>' + pendentes.length + ' ' + (pendentes.length === 1 ? 'dia para enviar' : 'dias para enviar') + '</span><strong>' + formatarSegundos(total50 + total100) + ' de HE</strong>';
        document.getElementById('helModalQtd').parentElement.style.display = 'none';
        document.getElementById('helModalTotal').parentElement.style.display = 'none';
        modalOverlay.classList.add('visible');
    }

    function fecharPreviaFinal() {
        if (processando || consultando) return;
        modalOverlay.classList.remove('visible');
    }

    async function enviarTodos() {try{return await executarOperacaoExclusivaHE(()=>enviarTodosProtegido());}catch(e){modalOverlay.classList.remove('visible');mensagem('warning',e.message);}}
    async function enviarTodosProtegido() {
        if (processando || consultando) return;
        if (!await conferirFeriadosParaAcao()) { modalOverlay.classList.remove('visible'); return; }

        const datasConfirmadas = [...document.querySelectorAll('#helLinhas tr')]
            .filter(tr => tr.dataset.incluido !== '1' && !linhaJaCadastrada(tr)).map(tr => dadosLinha(tr).data).join('|');
        document.getElementById('helModalConfirmar').disabled = true;
        if (!await atualizarExistentes()) { modalOverlay.classList.remove('visible'); return; }
        const datasAtuais = [...document.querySelectorAll('#helLinhas tr')]
            .filter(tr => tr.dataset.incluido !== '1' && !linhaJaCadastrada(tr)).map(tr => dadosLinha(tr).data).join('|');
        if (datasConfirmadas !== datasAtuais) {
            modalOverlay.classList.remove('visible');
            mensagem('warning', 'Os dias cadastrados mudaram desde a conferência. Revise as linhas e abra a confirmação novamente.');
            return;
        }
        // Proteção contra duplo clique: trava imediatamente.
        processando = true;
        const botaoModal = document.getElementById('helModalConfirmar');
        botaoModal.disabled = true;
        modalOverlay.classList.remove('visible');

        const linhas = validarTudo();
        if (!linhas) {
            processando = false;
            atualizarResumo();
            return;
        }

        const pendentes = linhas.filter(tr => tr.dataset.incluido !== '1' && !linhaJaCadastrada(tr));
        if (!pendentes.length || !todosProntosParaEnviar()) {
            processando = false;
            const alteradas = pendentes.filter(tr => tr.dataset.alteradaAposConferencia === '1').length;
            mensagem(
                'error',
                alteradas
                    ? `${alteradas} lançamento(s) foram alterados após a conferência. Calcule novamente antes de enviar.`
                    : 'Os lançamentos deixaram de estar prontos para envio. Calcule novamente.'
            );
            atualizarResumo();
            return;
        }

        cancelarSolicitado = false;
        setBloqueado(true);
        document.getElementById('helCancelar').disabled = false;
        let enviados = 0;
        let jaCadastrados = 0;

        const metaNova = metaAuditoriaAtual();
        const mesmaAuditoria = auditoriaMeta &&
            auditoriaMeta.rf === metaNova.rf &&
            auditoriaMeta.mesHoras === metaNova.mesHoras &&
            auditoriaMeta.periodo === metaNova.periodo;
        if (!mesmaAuditoria || auditoriaEhAnterior) {
            auditoria = [];
            auditoriaMeta = metaNova;
        } else if (!auditoriaMeta) {
            auditoriaMeta = metaNova;
        }
        auditoriaEhAnterior = false;
        renderAuditoria();

        try {
            for (let i = 0; i < pendentes.length; i++) {
                if (cancelarSolicitado) {
                    mensagem('warning', MODO_SIMULACAO
                        ? `Simulação interrompida. ${enviados} lançamento(s) já haviam sido simulados.`
                        : `Processamento interrompido. ${enviados} lançamento(s) já haviam sido confirmados.`);
                    return;
                }

                const tr = pendentes[i];
                const linha = dadosLinha(tr);

                const erroCritico = validarLinhaCritica(linha);
                if (erroCritico) {
                    delete tr.dataset.preview;
                    aplicarStatusLinha(tr, `Bloqueado: ${erroCritico}`, 'hel-error');
                    throw new Error(`Envio bloqueado em ${linha.data}: ${erroCritico}. Nenhum POST de inclusão foi feito para essa linha.`);
                }

                aplicarStatusLinha(tr, 'Recalculando...', 'hel-processing');
                progresso(i, pendentes.length, `Recalculando ${linha.data}`);

                const compat = linhaParaSistema(linha);
                if (!compat.ok) {
                    delete tr.dataset.preview;
                    aplicarStatusLinha(tr, `Bloqueado: ${compat.erro}`, 'hel-error');
                    throw new Error(`Envio bloqueado em ${linha.data}: ${compat.erro}.`);
                }

                // Recalcula exatamente o mesmo horário técnico derivado do
                // horário real, sempre com carga 04:00.
                const estado = await estadoInicial();
                let calculo;try{calculo=await post(estado,compat.linhaSistema,'calcular');}catch(e){delete tr.dataset.preview;aplicarStatusLinha(tr,'Cálculo inválido — recalcular','hel-error');throw e;}
                const r = resultadoCalculo(calculo);

                if (!r.retornado) {
                    delete tr.dataset.preview;
                    const msg = calculo.mensagens?.find(Boolean) || 'O sistema não retornou valores de HE no recálculo.';
                    aplicarStatusLinha(tr, 'Recálculo não retornado — conferir', 'hel-error');
                    throw new Error(`${linha.data}: ${msg}`);
                }

                const preview50 = Number(tr.dataset.seg50 || 0);
                const preview100 = Number(tr.dataset.seg100 || 0);

                if (r.total !== heEsperadaSegundos(linha) || r.seg50 !== preview50 || r.seg100 !== preview100) {
                    delete tr.dataset.preview;
                    aplicarStatusLinha(tr, 'Resultado mudou — recalcular', 'hel-error');
                    adicionarAuditoria({
                        data: linha.data,
                        he50: formatarSegundos(r.seg50),
                        he100: formatarSegundos(r.seg100),
                        total: formatarSegundos(r.total),
                        resultado: 'Não incluído',
                        observacao: 'O cálculo mudou em relação à conferência.',
                        ok: false
                    });
                    throw new Error(`O cálculo de ${linha.data} mudou em relação à conferência. Essa linha não foi incluída.`);
                }

                const erroAntesDeIncluir = validarLinhaCritica(linha);
                if (erroAntesDeIncluir) {
                    aplicarStatusLinha(tr, `Bloqueado: ${erroAntesDeIncluir}`, 'hel-error');
                    throw new Error(`Inclusão cancelada em ${linha.data}: ${erroAntesDeIncluir}.`);
                }

                aplicarStatusLinha(tr, 'Incluindo...', 'hel-processing');
                progresso(i, pendentes.length, `Incluindo ${linha.data}`);

                let operacao;
                try {operacao=registrarOperacaoHE(infoServidor(),periodoSelecionado(),compat.linhaSistema,r.seg50,r.seg100);tr.dataset.operacaoId=operacao.id;}
                catch(e){aplicarStatusLinha(tr,'Envio impedido — não foi possível preservar o bloqueio','hel-error');throw e;}
                let inclusao;
                try {
                    inclusao = await post(calculo.estado, compat.linhaSistema, 'incluir');
                } catch (erroRede) {
                    tr.dataset.incerto = '1';
            tr.dataset.contextoTerminal = chaveConsultaAtual();
                    tr.classList.add('hel-uncertain');
                    aplicarStatusLinha(tr, '⚠ Inclusão sem confirmação — conferir no sistema', 'hel-warning');
                    tr.querySelectorAll('input, button').forEach(el => el.disabled = true);
                    adicionarAuditoria({
                        data: linha.data,
                        he50: formatarSegundos(r.seg50),
                        he100: formatarSegundos(r.seg100),
                        total: formatarSegundos(r.total),
                        resultado: 'Conferir manualmente',
                        observacao: 'Falha de comunicação durante a inclusão. Não reenvie automaticamente antes de conferir no sistema.',
                        ok: false,
                        incerto: true
                    });
                    salvarRascunho();
                    throw new Error(`Inclusão de ${linha.data} sem confirmação. Confira no sistema antes de qualquer nova tentativa.`);
                }

                const sucesso = inclusao.html.includes('Dados incluídos com sucesso');
                const erroCampos = inclusao.html.includes('Favor verificar se os campos estão preenchidos corretamente');
                const mensagemDuplicidade = (inclusao.mensagens || []).find(m =>
                    /já\s+existe\s+horas\s+extras\s+lançadas\s+para\s+este\s+funcionário\s+nesta\s+data/i.test(
                        String(m || '').normalize('NFC')
                    )
                ) || '';

                if (!sucesso && mensagemDuplicidade) {
                    concluirOperacaoHE(operacao,'recusada-duplicidade');
                    // Erro conhecido e determinístico do sistema: a data já foi
                    // cadastrada para o servidor. Não reenviar e não interromper
                    // os demais dias do lote.
                    sincronizarEstadoDaPagina(inclusao.doc);

                    tr.dataset.jaExistia = '1';
            tr.dataset.contextoTerminal = chaveConsultaAtual();
                    tr.dataset.preview = '1';
                    tr.dataset.seg50 = String(r.seg50);
                    tr.dataset.seg100 = String(r.seg100);
                    tr.dataset.total = String(r.total);
                    tr.dataset.ajusteHorario = compat.ajustado ? '1' : '0';
                    tr.dataset.horarioSistema = compat.horarioSistema || '';
                    tr.dataset.assinatura = assinaturaLinha(tr);

                    aplicarStatusLinha(tr, 'Já cadastrado nesta data', 'hel-warning');
                    tr.querySelectorAll('input').forEach(el => el.disabled = true);

                    jaCadastrados++;
                    adicionarAuditoria({
                        data: linha.data,
                        he50: formatarSegundos(r.seg50),
                        he100: formatarSegundos(r.seg100),
                        total: formatarSegundos(r.total),
                        resultado: 'Já cadastrado',
                        observacao: mensagemDuplicidade,
                        ok: false,
                        jaExistia: true
                    });

                    atualizarResumo();
                    salvarRascunho();
                    progresso(
                        i + 1,
                        pendentes.length,
                        `${enviados} incluído(s) · ${jaCadastrados} já cadastrado(s) · ${i + 1}/${pendentes.length} processado(s)`
                    );
                    await sleep(250);
                    continue;
                }

                if (!sucesso) {
                    if (erroCampos) {
                        concluirOperacaoHE(operacao,'recusada-campos');
                        delete tr.dataset.preview;
                        aplicarStatusLinha(tr, 'Dados recusados — revisar', 'hel-error');
                        adicionarAuditoria({
                            data: linha.data,
                            he50: formatarSegundos(r.seg50),
                            he100: formatarSegundos(r.seg100),
                            total: formatarSegundos(r.total),
                            resultado: 'Não incluído',
                            observacao: 'O sistema recusou os dados.',
                            ok: false
                        });
                        throw new Error(`O sistema recusou os dados de ${linha.data}.`);
                    }

                    // Resposta recebida, porém sem confirmação explícita: não assumir falha nem reenviar.
                    tr.dataset.incerto = '1';
            tr.dataset.contextoTerminal = chaveConsultaAtual();
                    tr.classList.add('hel-uncertain');
                    aplicarStatusLinha(tr, '⚠ Inclusão sem confirmação — conferir no sistema', 'hel-warning');
                    tr.querySelectorAll('input, button').forEach(el => el.disabled = true);
                    adicionarAuditoria({
                        data: linha.data,
                        he50: formatarSegundos(r.seg50),
                        he100: formatarSegundos(r.seg100),
                        total: formatarSegundos(r.total),
                        resultado: 'Conferir manualmente',
                        observacao: 'A resposta não trouxe confirmação explícita de sucesso ou erro. Não reenvie antes de conferir.',
                        ok: false,
                        incerto: true
                    });
                    salvarRascunho();
                    throw new Error(`O sistema não confirmou o resultado da inclusão de ${linha.data}. Confira manualmente.`);
                }

                // A inclusão foi confirmada: atualiza os hidden fields da página
                // com o estado mais recente devolvido pelo servidor, para que a
                // próxima linha parta de um snapshot atual.
                sincronizarEstadoDaPagina(inclusao.doc);

                tr.dataset.incluido = '1';
                tr.dataset.contextoTerminal = chaveConsultaAtual();
                tr.dataset.preview = '1';
                tr.dataset.seg50 = String(r.seg50);
                tr.dataset.seg100 = String(r.seg100);
                tr.dataset.total = String(r.total);
                tr.dataset.ajusteHorario = compat.ajustado ? '1' : '0';
                tr.dataset.horarioSistema = compat.horarioSistema || '';
                tr.dataset.assinatura = assinaturaLinha(tr);
                aplicarStatusLinha(tr, MODO_SIMULACAO ? '✓ Simulado' : 'Incluído', 'hel-ok');
                tr.querySelectorAll('input').forEach(el => el.disabled = true);

                enviados++;
                adicionarAuditoria({
                    data: linha.data,
                    he50: formatarSegundos(r.seg50),
                    he100: formatarSegundos(r.seg100),
                    total: formatarSegundos(r.total),
                    resultado: MODO_SIMULACAO ? 'Simulação OK' : 'Incluído',
                    observacao: MODO_SIMULACAO
                        ? (compat.ajustado
                            ? `Simulação com compatibilidade: ${compat.horarioInformado} → ${compat.horarioSistema}. Nenhum dado real foi enviado.`
                            : 'Resultado gerado localmente; nenhum dado foi enviado.')
                        : (compat.ajustado
                            ? `Confirmação recebida. Compatibilidade de horário aplicada: ${compat.horarioInformado} → ${compat.horarioSistema}.`
                            : 'Confirmação recebida do sistema.'),
                    ok: true
                });

                atualizarResumo();
                salvarRascunho();
                progresso(enviados, pendentes.length, MODO_SIMULACAO
                    ? `${enviados}/${pendentes.length} simulado(s)`
                    : `${enviados}/${pendentes.length} incluído(s)`);
                await sleep(350);
            }

            if (MODO_SIMULACAO) {
                mensagem('success', `${enviados} lançamento(s) simulados com sucesso. Nenhum dado real foi enviado.`);
            } else if (jaCadastrados) {
                mensagem(
                    enviados ? 'warning' : 'info',
                    `Processamento concluído: ${enviados} lançamento(s) incluído(s) e ${jaCadastrados} já cadastrado(s) anteriormente.`
                );
            } else {
                mensagem('success', `${enviados} lançamento(s) incluído(s) com sucesso.`);
            }
            progresso(pendentes.length, pendentes.length, 'Processamento concluído');
            salvarRascunho();
        } catch (erro) {
            console.error(erro);
            mensagem('error', 'Processamento interrompido: ' + erro.message);
        } finally {
            const verificar = linhas.some(tr => tr.dataset.incluido === '1' || tr.dataset.incerto === '1');
            if (verificar) {
                try { await verificarResultados(true); }
                catch (erro) { mensagem('warning', 'A conferência após envio não foi concluída: ' + erro.message); }
            }
            processando = false;
            setBloqueado(false);
            atualizarResumo();
            const aindaPendente = [...document.querySelectorAll('#helLinhas tr')]
                .some(tr => tr.dataset.incluido !== '1' && !linhaJaCadastrada(tr));
            if (aindaPendente) salvarRascunho();
            else salvarRascunho();
        }
    }

    // ---------------------------------------------------------------------
    // Copiar resumo / resultado
    // ---------------------------------------------------------------------
    async function copiarTexto(texto, mensagemSucesso) {
        try {
            await navigator.clipboard.writeText(texto);
            mensagem('success', mensagemSucesso);
        } catch {
            prompt('Copie o texto abaixo:', texto);
        }
    }

    function textoResumo() {
        const h = mesAnoHoras();
        const p = periodoSelecionado();
        const info = infoServidor();
        const informados = Number(document.getElementById('helResumoInformados').textContent || 0);
        const calculados = document.getElementById('helResumoCalculados').textContent;
        const he50 = document.getElementById('helResumo50').textContent;
        const he100 = document.getElementById('helResumo100').textContent;
        const total = document.getElementById('helResumoTotal').textContent;
        const incluidos = document.getElementById('helResumoIncluidos').textContent;
        return `HORAS EXTRAS\n\nServidor: ${info ? `${info.rf} — ${info.nome}` : txtServidor.value.trim() || '-'}\nMês das horas: ${MESES[h.mes - 1]}/${h.ano}\nPeríodo: ${p.nome}/${p.ano}\n\n${informados} dia(s) · HE pendente: ${document.getElementById('helQtdPrevista').textContent}\nDias calculados: ${calculados}/${informados}\nHE 50%: ${he50}\nHE 100%: ${he100}\nTotal HE calculado: ${total}\n${MODO_SIMULACAO ? 'Simulados' : 'Incluídos'}: ${incluidos}/${informados}`;
    }

    // ---------------------------------------------------------------------
    // Novo lote
    // ---------------------------------------------------------------------
    function novoLote() {
        if (processando || consultando) return;
        const temLinhas = document.querySelectorAll('#helLinhas tr').length > 0;
        if (temLinhas && !confirm(MODO_SIMULACAO
            ? 'Iniciar uma nova simulação? Os dias da lista atual serão limpos. O relatório continuará visível até você começar a próxima.'
            : 'Iniciar um novo lote? Os dias da lista atual serão limpos. O relatório continuará visível até você começar o próximo lote.')) return;

        descartarRascunhoAtual();
        document.getElementById('helConsiderarFeriados').checked=false;
        document.getElementById('helLinhas').innerHTML = '';
        txtServidor.value = '';
        txtReg.value = '';
        // Mantém mês, período e horário padrão para facilitar vários servidores do mesmo mês.
        auditoriaEhAnterior = auditoria.length > 0;
        renderAuditoria();
        mostrarAvisosEntrada([]);
        ocultarProgresso();
        atualizarServidorSelecionado();
        atualizarResumo();
        mensagem('info', MODO_SIMULACAO
            ? 'Nova simulação iniciada. Mês, período, horário padrão e relatório anterior foram mantidos.'
            : 'Novo lote iniciado. Mês, período, horário padrão e relatório anterior foram mantidos. Selecione o próximo servidor.');
        atualizarAvisoRascunho();
    }

    // ---------------------------------------------------------------------
    // Eventos
    // ---------------------------------------------------------------------
    mesHorasEl.addEventListener('change', () => {
        atualizarPeriodo();
        atualizarAvisoRascunho();
    });
    anoHorasEl.addEventListener('change', () => {
        atualizarPeriodo();
        atualizarAvisoRascunho();
    });
    periodoDiferenteEl.addEventListener('change', atualizarPeriodo);
    periodoMesEl.addEventListener('change', () => {
        atualizarAvisoPeriodo();
        invalidarPreviaTodas();
        salvarRascunho();
    });
    periodoAnoEl.addEventListener('change', () => {
        atualizarAvisoPeriodo();
        invalidarPreviaTodas();
        salvarRascunho();
    });

    function servidorMudou() {
        atualizarServidorSelecionado();
        invalidarPreviaTodas();
        atualizarResumo();
        clearTimeout(timerServidor);
        timerServidor = setTimeout(() => {
            atualizarServidorSelecionado();
            atualizarAvisoRascunho();
            salvarRascunho();
        }, 250);
    }

    txtServidor.addEventListener('input', servidorMudou);
    txtServidor.addEventListener('change', servidorMudou);
    txtServidor.addEventListener('blur', () => setTimeout(servidorMudou, 100));

    // O autocomplete original pode atualizar txtReg por JavaScript sem disparar evento.
    setInterval(() => {
        const snapshot = `${txtServidor.value}|${txtReg.value}`;
        if (snapshot !== ultimoSnapshotServidor) {
            if (ultimoSnapshotServidor && !processando) invalidarPreviaTodas();
            ultimoSnapshotServidor = snapshot;
            atualizarServidorSelecionado();
            atualizarResumo();
        }
    }, 400);

    ['helPadEntrada', 'helPadSaidaAl', 'helPadRetorno', 'helPadSaida'].forEach(id => {
        document.getElementById(id).addEventListener('input', () => {
            salvarRascunho();
        });
    });

    document.getElementById('helAdicionarDias').onclick = adicionarDias;
    document.getElementById('helMesInteiro').onclick = adicionarMesInteiro;
    document.getElementById('helPrimeiraQuinzena').onclick = adicionarPrimeiraQuinzena;
    document.getElementById('helSegundaQuinzena').onclick = adicionarSegundaQuinzena;
    document.getElementById('helNovaLinha').onclick = () => {
        adicionarLinha();
        ordenarLinhas();
        salvarRascunho();
    };
    document.getElementById('helAplicarPadrao').onclick = aplicarHorarioPadrao;
    document.getElementById('helCalcular').onclick = calcularTodos;
    document.getElementById('helEnviar').onclick = abrirPreviaFinal;
    document.getElementById('helModalCancelar').onclick = fecharPreviaFinal;
    document.getElementById('helModalConfirmar').onclick = enviarTodos;

    ['helConfirmExcecao', 'helConfirmFuturas', 'helConfirmCompat'].forEach(id => {
        document.getElementById(id).addEventListener('change', atualizarConfirmacaoModal);
    });

    document.getElementById('helCancelar').onclick = () => {
        cancelarSolicitado = true;
        mensagem('warning', 'O processamento será interrompido assim que a operação atual terminar.');
    };
    document.getElementById('helCopiarResumo').onclick = () => copiarTexto(textoResumo(), 'Resumo copiado.');
    document.getElementById('helCopiarResultado').onclick = () => copiarTexto(textoAuditoria(), 'Resultado copiado.');
    document.getElementById('helSalvarRelatorio').onclick = salvarRelatorio;
    document.getElementById('helSalvarLote').onclick = salvarRelatorio;
    document.getElementById('helConsultarExistentes').onclick = () => atualizarExistentes();
    document.getElementById('helNovoLote').onclick = novoLote;

    document.getElementById('helLimpar').onclick = () => {
        if (processando || consultando) return;
        const possuiIncluidos = [...document.querySelectorAll('#helLinhas tr')].some(tr => tr.dataset.incluido === '1');
        const possuiIncerto = [...document.querySelectorAll('#helLinhas tr')].some(tr => tr.dataset.incerto === '1');
        const possuiJaCadastrado = [...document.querySelectorAll('#helLinhas tr')].some(tr => linhaJaCadastrada(tr));
        if (possuiIncluidos || possuiIncerto || possuiJaCadastrado) {
            alert(possuiIncerto
                ? 'Há linha com inclusão sem confirmação. Confira no sistema e use “Novo lote” quando terminar.'
                : (possuiJaCadastrado
                    ? 'Há dia(s) identificado(s) como já cadastrado(s) no sistema. Use “Novo lote” quando terminar a conferência.'
                    : 'Existem lançamentos já incluídos. Use “Novo lote” para iniciar outro servidor/lote.'));
            return;
        }
        if (!confirm('Remover todos os dias informados?')) return;
        document.getElementById('helLinhas').innerHTML = '';
        atualizarResumo();
        mostrarAvisosEntrada([]);
        mensagem('info', 'Lista limpa.');
        descartarRascunhoAtual();
    };

    document.getElementById('helRestaurarRascunho').onclick = restaurarRascunho;
    document.getElementById('helDescartarRascunho').onclick = () => {
        const sel = document.getElementById('helDraftSelect');
        const texto = sel.options[sel.selectedIndex]?.textContent || 'este rascunho';
        if (confirm(`Descartar ${texto}?`)) {
            descartarRascunhoSelecionado();
            mensagem('info', 'Rascunho descartado.');
        }
    };

    modalOverlay.addEventListener('click', e => {
        if (e.target === modalOverlay) fecharPreviaFinal();
    });

    // ---------------------------------------------------------------------
    // Inicialização
    // ---------------------------------------------------------------------
    iniciarLayoutCompacto();
    iniciarRecursosConferencia();
    sistemaCarga.value = '04:00';
    migrarRascunhoLegado();
    atualizarPeriodo();
    atualizarServidorSelecionado();
    atualizarResumo();
    renderAuditoria();
    atualizarAvisoRascunho();

    console.log('[HE Lote] Versão 4.6 beta 18 carregada.' + (MODO_SIMULACAO ? ' MODO SIMULAÇÃO.' : ''));
    }

    // ---------------------------------------------------------------------
    // Consulta / exclusão por registro
    // ---------------------------------------------------------------------

    function inserirCreditosHE(container) {
        if (!container || container.querySelector('.hel-creditos')) return;
        const style = document.createElement('style');
        style.textContent = '.hel-creditos{margin:20px 0 10px;padding:14px 16px;border:1px solid #d4dce3;border-top:3px solid #2f5d86;border-radius:3px;background:transparent;color:#465866;font-family:inherit;font-size:13px;line-height:1.6;box-sizing:border-box}.hel-creditos-topo{display:flex;justify-content:space-between;align-items:baseline;gap:8px 24px;flex-wrap:wrap}.hel-creditos strong{color:#244866;font-weight:700}.hel-creditos p{margin:0}.hel-creditos .hel-creditos-autoria{margin-top:9px;padding-top:9px;border-top:1px solid #d4dce3;font-size:12px}.hel-creditos a{display:inline-flex;align-items:center;gap:5px;vertical-align:middle;color:#244866;font-weight:600;white-space:nowrap;text-decoration:underline;text-underline-offset:2px}.hel-creditos .hel-whatsapp-icon{width:17px;height:17px;flex:none;color:#16813d}.hel-creditos a:focus-visible{outline:2px solid #2f5d86;outline-offset:3px}';
        document.head.appendChild(style);
        const footer = document.createElement('footer');
        footer.className = 'hel-creditos';
        footer.setAttribute('aria-label', 'Autoria do script e contato');
        footer.innerHTML = '<div class="hel-creditos-topo"><p>Script desenvolvido por <strong>Nilson Cruz</strong></p><p>Encontrou um bug, uma falha ou quer sugerir uma melhoria? <a href="https://github.com/deadidlemmo/horas-extras-userscript/issues" target="_blank" rel="noopener noreferrer">GitHub Issues</a></p></div><p class="hel-creditos-autoria">Este script foi desenvolvido para melhorar a interface e facilitar o uso da página. Os créditos se referem exclusivamente ao script, e não ao sistema original de banco de horas.</p>';
        queueMicrotask(() => container.appendChild(footer));
    }

    function initConsulta() {
        if (document.getElementById('helq-app')) return;

        const form = document.getElementById('form1');
        const txtRegistro = document.getElementById('TextBox1');
        const mes = document.getElementById('DropDownList1');
        const ano = document.getElementById('anoPeriodo');
        const btnConsultar = document.getElementById('Button1');
        const btnLimpar = document.getElementById('btnLimpar');
        const txtExcluir = document.getElementById('TextBox2');
        const btnExcluir = document.getElementById('btnExcluir');
        const gridOriginal = document.getElementById('GridView1');
        const total50Original = document.getElementById('L50');
        const total100Original = document.getElementById('L100');
        const voltar = document.getElementById('HyperLink1');

        if (!form || !txtRegistro || !mes || !ano || !btnConsultar || !btnLimpar || !txtExcluir || !btnExcluir) {
            console.error('[HE Consulta] Controles originais não encontrados.');
            return;
        }

        const DELETE_PENDING_KEY = 'pg_he_consulta_delete_pending_v44';
        const DIAS_SEMANA = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
        const MESES = [
            'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
            'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
        ];

        const normalizarData = valor => {
            const texto = String(valor || '').replace(/\s+/g, ' ').trim();
            const m = texto.match(/\b(\d{2}\/\d{2}\/\d{4})\b/);
            return m ? m[1] : texto;
        };

        const dataParaDate = valor => {
            const m = String(valor || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
            if (!m) return null;
            const d = Number(m[1]);
            const mo = Number(m[2]);
            const y = Number(m[3]);
            const dt = new Date(y, mo - 1, d, 12, 0, 0, 0);
            if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
            return dt;
        };

        const duracaoParaMinutos = valor => {
            const texto = String(valor || '').trim();
            if (!texto) return 0;
            const hm = texto.match(/^(\d+):(\d{2})$/);
            if(duracaoRetornadaValida(texto)){const a=texto.split(':').map(Number);return a[0]*60+a[1]+(a[2]||0)/60;}
            if (/^\d+[.,]\d+$/.test(texto)) {
                const n = Number(texto.replace(',', '.'));
                return Number.isFinite(n) ? Math.round(n * 60) : 0;
            }
            return 0;
        };

        const minutosParaDuracao = minutos => {
            const total = Math.max(0, Math.round(Number(minutos) || 0));
            const h = Math.floor(total / 60);
            const m = total % 60;
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        };

        const normalizarTotal = valor => minutosParaDuracao(duracaoParaMinutos(valor));

        const periodoAtual = () => {
            const mesTxt = mes.options[mes.selectedIndex]?.textContent?.trim() || mes.value || '—';
            const anoTxt = ano.options[ano.selectedIndex]?.textContent?.trim() || ano.value || '—';
            return `${mesTxt}/${anoTxt}`;
        };

        const extrairRegistros = () => {
            if (!gridOriginal?.rows || gridOriginal.rows.length < 2) return [];
            return [...gridOriginal.rows].slice(1).map((tr, indice) => {
                const c = tr.cells;
                if (!c || c.length < 12) return null;
                const data = normalizarData(c[3].textContent);
                const dt = dataParaDate(data);
                const he50 = c[8].textContent.trim();
                const he100 = c[9].textContent.trim();
                const totalMin = duracaoParaMinutos(he50) + duracaoParaMinutos(he100);
                return {
                    indiceOriginal: indice,
                    registro: c[0].textContent.trim(),
                    nome: c[1].textContent.trim(),
                    periodo: c[2].textContent.trim(),
                    data,
                    dataObj: dt,
                    diaSemana: dt ? DIAS_SEMANA[dt.getDay()] : '—',
                    fimDeSemana: dt ? (dt.getDay() === 0 || dt.getDay() === 6) : false,
                    entrada: c[4].textContent.trim(),
                    saidaAl: c[5].textContent.trim(),
                    retornoAl: c[6].textContent.trim(),
                    saida: c[7].textContent.trim(),
                    he50,
                    he100,
                    totalDia: minutosParaDuracao(totalMin),
                    totalDiaMin: totalMin,
                    temHE100: duracaoParaMinutos(he100) > 0,
                    adNoturno: c[10].textContent.trim(),
                    usuario: c[11].textContent.trim()
                };
            }).filter(Boolean).sort((a, b) => {
                if (a.dataObj && b.dataObj) return a.dataObj - b.dataObj;
                if (a.dataObj) return -1;
                if (b.dataObj) return 1;
                return a.indiceOriginal - b.indiceOriginal;
            });
        };

        let registros = extrairRegistros();
        let total50 = normalizarTotal(total50Original?.textContent || minutosParaDuracao(registros.reduce((s, r) => s + duracaoParaMinutos(r.he50), 0)));
        let total100 = normalizarTotal(total100Original?.textContent || minutosParaDuracao(registros.reduce((s, r) => s + duracaoParaMinutos(r.he100), 0)));
        let totalGeral = minutosParaDuracao(duracaoParaMinutos(total50) + duracaoParaMinutos(total100));
        let servidorNome = registros[0]?.nome || '—';
        let servidorRegistro = registros[0]?.registro || txtRegistro.value.trim() || '—';

        const style = document.createElement('style');
        style.textContent = `
            :root {
                --helq-blue: #2f5d86;
                --helq-blue-dark: #244866;
                --helq-blue-soft: #eef4f9;
                --helq-green: #2f6f45;
                --helq-green-soft: #edf7f0;
                --helq-amber: #9a6700;
                --helq-amber-soft: #fff7e3;
                --helq-red: #9b2c2c;
                --helq-red-dark: #7c2020;
                --helq-red-soft: #fff0f0;
                --helq-purple-soft: #f5f0fb;
                --helq-purple: #6a4a8c;
                --helq-gray-050: #fbfbfb;
                --helq-gray-100: #f4f4f4;
                --helq-gray-200: #e4e4e4;
                --helq-gray-300: #c9c9c9;
                --helq-gray-500: #707070;
                --helq-gray-700: #333;
            }

            #helq-app {
                max-width: 1240px;
                margin: 16px auto 40px;
                padding: 0 10px;
                font-family: Arial, Helvetica, sans-serif;
                font-size: 13px;
                color: #222;
            }
            #helq-app * { box-sizing: border-box; }

            .helq-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 20px;
                margin-bottom: 15px;
                padding: 10px 0 12px 12px;
                border-bottom: 1px solid #aeb7bf;
                border-left: 5px solid var(--helq-blue);
            }
            .helq-header h1 {
                margin: 0;
                color: #222;
                font-size: 22px;
                font-weight: 700;
            }
            .helq-subtitle {
                margin-top: 3px;
                color: #666;
                font-size: 12px;
            }
            .helq-back {
                color: var(--helq-blue-dark);
                font-weight: 700;
                text-decoration: none;
                white-space: nowrap;
            }
            .helq-back:hover { text-decoration: underline; }

            .helq-section {
                margin-bottom: 14px;
                border: 1px solid #b9b9b9;
                background: #fff;
            }
            .helq-section-title {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                padding: 9px 12px;
                border-bottom: 1px solid #b9b9b9;
                background: #edf1f4;
                color: #283746;
                font-size: 14px;
                font-weight: 700;
            }
            .helq-section-title-note {
                color: #5e6a73;
                font-size: 11px;
                font-weight: 600;
            }
            .helq-section-body { padding: 13px; }

            .helq-filter-grid {
                display: grid;
                grid-template-columns: 170px minmax(270px, 1fr) auto;
                gap: 12px;
                align-items: end;
            }
            .helq-field {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .helq-field label {
                color: #333;
                font-size: 12px;
                font-weight: 700;
            }
            .helq-periodo {
                display: grid;
                grid-template-columns: minmax(145px, 1fr) 90px;
                gap: 6px;
            }
            #helq-app input,
            #helq-app select {
                height: 34px !important;
                border: 1px solid #949494 !important;
                border-radius: 2px !important;
                padding: 5px 7px !important;
                background: #fff;
                color: #222;
                font-family: Arial, Helvetica, sans-serif !important;
                font-size: 13px !important;
            }
            #helq-app input:focus,
            #helq-app select:focus {
                outline: 2px solid rgba(47,93,134,.18) !important;
                border-color: var(--helq-blue) !important;
            }
            #helqRegistroBox input { width: 100% !important; }
            #helqMesBox select,
            #helqAnoBox select { width: 100% !important; }

            .helq-actions {
                display: flex;
                flex-wrap: wrap;
                gap: 6px;
            }
            .helq-btn {
                min-height: 34px;
                border: 1px solid #858585;
                border-radius: 2px;
                background: #efefef;
                padding: 6px 12px;
                color: #222;
                cursor: pointer;
                font-weight: 700;
            }
            .helq-btn:hover { background: #dfdfdf; }
            .helq-btn:disabled { opacity: .55; cursor: not-allowed; }
            .helq-btn-main {
                border-color: var(--helq-blue-dark) !important;
                background: var(--helq-blue) !important;
                color: #fff !important;
            }
            .helq-btn-main:hover { background: var(--helq-blue-dark) !important; }
            .helq-btn-copy {
                border-color: #9eabb5;
                background: #f7f9fa;
                color: #334955;
            }
            .helq-btn-copy:hover { background: #edf2f5; }

            #helq-app input[type="submit"] {
                width: auto !important;
                min-width: 105px;
                cursor: pointer;
                font-weight: 700;
            }
            #helq-app #Button1 {
                border-color: var(--helq-blue-dark) !important;
                background: var(--helq-blue) !important;
                color: #fff !important;
            }

            .helq-summary-grid {
                display: grid;
                grid-template-columns: minmax(260px, 2fr) repeat(4, minmax(115px, .8fr));
                gap: 10px;
                margin-bottom: 12px;
            }
            .helq-person,
            .helq-total-card {
                min-height: 76px;
                border: 1px solid #c8cdd1;
                background: #f8fafb;
                padding: 10px 12px;
            }
            .helq-person span,
            .helq-total-card span {
                display: block;
                margin-bottom: 4px;
                color: #66717a;
                font-size: 10px;
                font-weight: 700;
                letter-spacing: .25px;
                text-transform: uppercase;
            }
            .helq-person strong {
                display: block;
                color: #2f3d48;
                font-size: 15px;
                line-height: 1.25;
            }
            .helq-person small {
                display: block;
                margin-top: 5px;
                color: #68747d;
                font-size: 11px;
            }
            .helq-total-card strong {
                color: var(--helq-blue-dark);
                font-size: 21px;
            }
            .helq-total-card.helq-total-geral {
                border-left: 4px solid var(--helq-blue);
                background: var(--helq-blue-soft);
            }
            .helq-total-card.helq-count-card strong { color: #34495e; }

            .helq-toolbar {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                margin-bottom: 10px;
            }
            .helq-context {
                color: #56636d;
                font-size: 12px;
            }
            .helq-context strong { color: #31424f; }

            .helq-status {
                display: none;
                margin-bottom: 10px;
                padding: 9px 11px;
                border: 1px solid #b9b9b9;
                border-left-width: 4px;
                line-height: 1.35;
            }
            .helq-status.visible { display: block; }
            .helq-status.success {
                border-color: #92b99a;
                border-left-color: var(--helq-green);
                background: var(--helq-green-soft);
                color: #245737;
            }
            .helq-status.warning {
                border-color: #dcc37f;
                border-left-color: var(--helq-amber);
                background: var(--helq-amber-soft);
                color: #6f4d08;
            }
            .helq-status.info {
                border-color: #a8bdce;
                border-left-color: var(--helq-blue);
                background: var(--helq-blue-soft);
                color: #24445e;
            }

            .helq-table-wrap {
                width: 100%;
                max-height: 620px;
                overflow: auto;
                border: 1px solid #b9b9b9;
                background: #fff;
            }
            .helq-table {
                width: 100%;
                min-width: 1000px;
                border-collapse: separate;
                border-spacing: 0;
                background: #fff;
                text-align: center;
            }
            .helq-table th {
                position: sticky;
                top: 0;
                z-index: 5;
                border-right: 1px solid #aeb7bf;
                border-bottom: 1px solid #aeb7bf;
                background: #e8ecef;
                color: #37424b;
                padding: 9px 7px;
                font-size: 11px;
                font-weight: 700;
                white-space: nowrap;
            }
            .helq-table td {
                border-right: 1px solid #d0d0d0;
                border-bottom: 1px solid #d0d0d0;
                background: #fff;
                color: #263238;
                padding: 7px 7px;
                font-size: 12px;
                white-space: nowrap;
            }
            .helq-table tbody tr:nth-child(even) td { background: #fafafa; }
            .helq-table tbody tr:hover td { background: #eef4f8 !important; }
            .helq-table tbody tr.helq-weekend td { background: #fff8e8; }
            .helq-table tbody tr.helq-weekend td:first-child { box-shadow: inset 4px 0 0 #c18a24; }
            .helq-table tbody tr.helq-he100 td { background: var(--helq-purple-soft); }
            .helq-table tbody tr.helq-he100 td:first-child { box-shadow: inset 4px 0 0 var(--helq-purple); }
            .helq-table tbody tr.helq-weekend.helq-he100 td:first-child {
                box-shadow: inset 4px 0 0 var(--helq-purple), inset 8px 0 0 #c18a24;
            }
            .helq-date-main {
                font-weight: 700;
                color: #244866;
            }
            .helq-day {
                margin-left: 5px;
                color: #66747d;
                font-size: 11px;
                font-weight: 600;
            }
            .helq-weekend .helq-day { color: #865c10; }
            .helq-he100-value {
                color: var(--helq-purple);
                font-weight: 700;
            }
            .helq-total-dia {
                color: #244866;
                font-weight: 700;
            }
            .helq-row-actions {
                display: flex;
                justify-content: center;
                gap: 5px;
            }
            .helq-row-btn {
                min-height: 28px;
                border: 1px solid #a7afb5;
                border-radius: 2px;
                background: #fff;
                padding: 4px 8px;
                color: #37474f;
                cursor: pointer;
                font-size: 11px;
                font-weight: 700;
            }
            .helq-row-btn:hover { background: #f1f4f6; }
            .helq-delete {
                border-color: #d0b0b0;
                color: var(--helq-red);
            }
            .helq-delete:hover {
                border-color: var(--helq-red);
                background: var(--helq-red-soft);
            }

            .helq-legend {
                display: flex;
                flex-wrap: wrap;
                gap: 12px;
                margin-top: 9px;
                color: #66717a;
                font-size: 11px;
            }
            .helq-legend-item { display: inline-flex; align-items: center; gap: 5px; }
            .helq-dot { width: 10px; height: 10px; border: 1px solid #bbb; display: inline-block; }
            .helq-dot-weekend { background: #fff8e8; border-color: #d8bd7a; }
            .helq-dot-he100 { background: var(--helq-purple-soft); border-color: #b9a4d0; }

            .helq-empty {
                padding: 24px 18px;
                border: 1px dashed #b9b9b9;
                background: #fafafa;
                color: #666;
                text-align: center;
            }

            .helq-modal-overlay {
                display: none;
                position: fixed;
                z-index: 999999;
                inset: 0;
                padding: 25px;
                overflow-y: auto;
                background: rgba(0,0,0,.45);
            }
            .helq-modal-overlay.visible { display: block; }
            .helq-modal {
                max-width: 620px;
                margin: 45px auto;
                border: 1px solid #777;
                background: #fff;
                box-shadow: 0 5px 20px rgba(0,0,0,.28);
            }
            .helq-modal-head {
                padding: 12px 14px;
                border-bottom: 1px solid #bbb;
                background: #e8ecef;
                color: #283746;
                font-size: 16px;
                font-weight: 700;
            }
            .helq-modal-body { padding: 14px; }
            .helq-modal-warning {
                margin-bottom: 12px;
                padding: 9px 10px;
                border-left: 4px solid var(--helq-red);
                background: var(--helq-red-soft);
                color: #7d2020;
                line-height: 1.35;
            }
            .helq-modal-grid {
                display: grid;
                grid-template-columns: 145px 1fr;
                border: 1px solid #d1d5d8;
                border-bottom: 0;
            }
            .helq-modal-grid .label,
            .helq-modal-grid .value {
                padding: 8px 9px;
                border-bottom: 1px solid #d1d5d8;
            }
            .helq-modal-grid .label {
                border-right: 1px solid #d1d5d8;
                background: #f2f4f5;
                color: #59666f;
                font-size: 11px;
                font-weight: 700;
            }
            .helq-modal-grid .value {
                color: #25333c;
                font-weight: 600;
                overflow-wrap: anywhere;
            }
            .helq-modal-actions {
                display: flex;
                justify-content: flex-end;
                gap: 7px;
                padding: 12px 14px;
                border-top: 1px solid #bbb;
                background: #f7f7f7;
            }
            .helq-danger {
                border-color: var(--helq-red-dark) !important;
                background: var(--helq-red) !important;
                color: #fff !important;
            }
            .helq-danger:hover { background: var(--helq-red-dark) !important; }

            @media(max-width: 900px) {
                .helq-summary-grid { grid-template-columns: 1fr 1fr; }
                .helq-person { grid-column: 1 / -1; }
                .helq-filter-grid { grid-template-columns: 1fr 1fr; }
                .helq-actions { grid-column: 1 / -1; }
            }
            @media(max-width: 650px) {
                #helq-app { padding: 0 6px; }
                .helq-header,
                .helq-toolbar { flex-direction: column; align-items: stretch; }
                .helq-filter-grid,
                .helq-summary-grid { grid-template-columns: 1fr; }
                .helq-person { grid-column: auto; }
                .helq-modal-grid { grid-template-columns: 1fr; }
                .helq-modal-grid .label { border-right: 0; padding-bottom: 3px; }
                .helq-modal-grid .value { padding-top: 3px; }
            }
        `;
        document.head.appendChild(style);

        const tituloOriginal = [...document.querySelectorAll('.style6')]
            .find(el => /CONSULTA DE HORAS EXTRAS POR REGISTRO/i.test(el.textContent || ''));
        const raizOriginal = tituloOriginal?.parentElement || null;
        const voltarHref = voltar?.getAttribute('href') || 'PrincipalDoUsuario.aspx';

        const app = document.createElement('div');
        app.id = 'helq-app';
        app.innerHTML = `
            <div class="helq-header">
                <div>
                    <h1>Consulta de Horas Extras</h1>
                    <div class="helq-subtitle">Consulta, conferência e exclusão por lançamento · <strong>v4.6 beta 18</strong></div>
                </div>
                <a class="helq-back" href="${voltarHref}">← Voltar</a>
            </div>

            <div class="helq-section">
                <div class="helq-section-title">Consultar servidor</div>
                <div class="helq-section-body">
                    <div class="helq-filter-grid">
                        <div class="helq-field">
                            <label>Registro</label>
                            <div id="helqRegistroBox"></div>
                        </div>
                        <div class="helq-field">
                            <label>Período da folha</label>
                            <div class="helq-periodo">
                                <div id="helqMesBox"></div>
                                <div id="helqAnoBox"></div>
                            </div>
                        </div>
                        <div class="helq-actions">
                            <div id="helqConsultarBox"></div>
                            <div id="helqLimparBox"></div>
                        </div>
                    </div>
                </div>
            </div>

            <div id="helqResultados" class="helq-section">
                <div class="helq-section-title">
                    <span>Lançamentos encontrados</span>
                    <span id="helqTituloContagem" class="helq-section-title-note">${registros.length} ${registros.length === 1 ? 'lançamento' : 'lançamentos'}</span>
                </div>
                <div class="helq-section-body">
                    <div id="helqStatus" class="helq-status"></div>

                    <div class="helq-summary-grid">
                        <div class="helq-person">
                            <span>Servidor consultado</span>
                            <strong id="helqServidorResumo">${escaparHtml(servidorNome)}</strong>
                            <small>Registro ${escaparHtml(servidorRegistro)} · Período da folha: ${escaparHtml(periodoAtual())}</small>
                        </div>
                        <div class="helq-total-card helq-count-card">
                            <span>Lançamentos</span>
                            <strong id="helqContagem">${registros.length}</strong>
                        </div>
                        <div class="helq-total-card">
                            <span>Total HE 50%</span>
                            <strong id="helqTotal50">${total50}</strong>
                        </div>
                        <div class="helq-total-card">
                            <span>Total HE 100%</span>
                            <strong id="helqTotal100">${total100}</strong>
                        </div>
                        <div class="helq-total-card helq-total-geral">
                            <span>Total geral</span>
                            <strong id="helqTotalGeral">${totalGeral}</strong>
                        </div>
                    </div>

                    <div class="helq-toolbar"><div><button type="button" id="helqExcluirSelecionados" class="helq-btn helq-danger" disabled>Excluir selecionados</button> <span id="helqSelecaoResumo">0 selecionados</span></div>
                        
                        <button type="button" class="helq-btn helq-btn-copy" id="helqCopiarResumo">Copiar resumo</button>
                    </div>

                    <div id="helqTabelaWrap" class="helq-table-wrap">
                        <table class="helq-table" id="helqTabela">
                            <thead>
                                <tr>
                                    <th><input type="checkbox" id="helqSelecionarTodos" aria-label="Selecionar todos os dias consultados"></th><th>Data</th>
                                    <th>Entrada</th>
                                    <th>Saída almoço</th>
                                    <th>Retorno</th>
                                    <th>Saída</th>
                                    <th>HE 50%</th>
                                    <th>HE 100%</th>
                                    <th>Total do dia</th>
                                    <th>Ações</th>
                                </tr>
                            </thead>
                            <tbody id="helqTabelaBody"></tbody>
                        </table>
                    </div>
                    <div id="helqSemResultados" class="helq-empty" style="display:none">Nenhum lançamento exibido. Informe o registro e o período e clique em Consultar.</div>
                    <div id="helqLegenda" class="helq-legend">
                        <span class="helq-legend-item"><span class="helq-dot helq-dot-weekend"></span> Sábado/domingo</span>
                        <span class="helq-legend-item"><span class="helq-dot helq-dot-he100"></span> Possui HE 100%</span>
                    </div>
                </div>
            </div>

            <div id="helqExcluirModal" class="helq-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="helqExcluirTitulo">
                <div class="helq-modal">
                    <div class="helq-modal-head" id="helqExcluirTitulo">Confirmar exclusão</div>
                    <div class="helq-modal-body">
                        <div class="helq-modal-warning">Esta ação utilizará a exclusão original do sistema. Confira os dados antes de continuar.</div>
                        <div class="helq-modal-grid">
                            <div class="label">Servidor</div><div class="value" id="helqExServidor">—</div>
                            <div class="label">Data</div><div class="value" id="helqExData">—</div>
                            <div class="label">Dia</div><div class="value" id="helqExDia">—</div>
                            <div class="label">Horário</div><div class="value" id="helqExHorario">—</div>
                            <div class="label">HE 50%</div><div class="value" id="helqEx50">—</div>
                            <div class="label">HE 100%</div><div class="value" id="helqEx100">—</div>
                            <div class="label">Total do dia</div><div class="value" id="helqExTotal">—</div>
                        </div>
                    </div>
                    <div class="helq-modal-actions">
                        <button type="button" class="helq-btn" id="helqCancelarExclusao">Cancelar</button>
                        <button type="button" class="helq-btn helq-danger" id="helqConfirmarExclusao">Excluir lançamento</button>
                    </div>
                </div>
            </div>

            <div id="helqDetalhesModal" class="helq-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="helqDetalhesTitulo">
                <div class="helq-modal">
                    <div class="helq-modal-head" id="helqDetalhesTitulo">Detalhes do lançamento</div>
                    <div class="helq-modal-body">
<div class="helq-det-person"><span class="helq-det-caption">Servidor</span><strong id="helqDetServidor">—</strong><div class="helq-det-identificacao"><div><span>RF</span><b id="helqDetRegistro">—</b></div><div><span>Período de lançamento</span><b id="helqDetPeriodo">—</b></div><div class="helq-det-data"><span>Data trabalhada</span><b id="helqDetData">—</b></div></div></div><section class="helq-det-section" aria-label="Horários"><h3>Horários</h3><div class="helq-det-values"><div><span>Entrada</span><strong id="helqDetEntrada">—</strong></div><div><span>Saída / almoço</span><strong id="helqDetSaidaAl">—</strong></div><div><span>Retorno / almoço</span><strong id="helqDetRetorno">—</strong></div><div><span>Saída</span><strong id="helqDetSaida">—</strong></div></div></section><section class="helq-det-section" aria-label="Horas extras"><h3>Horas extras</h3><div class="helq-det-values"><div><span>HE 50%</span><strong id="helqDet50">—</strong></div><div><span>HE 100%</span><strong id="helqDet100">—</strong></div><div><span>Adicional noturno</span><strong id="helqDetAdNoturno">—</strong></div><div><span>Total do dia</span><strong id="helqDetTotal">—</strong></div></div></section><div class="helq-det-user">Lançado por <strong id="helqDetUsuario">—</strong></div>
                    </div>
                    <div class="helq-modal-actions">
                        <button type="button" class="helq-btn helq-btn-main" id="helqFecharDetalhes">Fechar</button>
                    </div>
                </div>
            </div>
        `;

        if (raizOriginal && raizOriginal.parentElement === form) {
            form.insertBefore(app, raizOriginal);
            raizOriginal.style.display = 'none';
        } else {
            form.appendChild(app);
        }

        // Os controles ASP.NET originais são reaproveitados sem alterar name/id.
        // Assim Consultar, Limpar e Excluir continuam fazendo o postback oficial.
        document.getElementById('helqRegistroBox').appendChild(txtRegistro);
        document.getElementById('helqMesBox').appendChild(mes);
        document.getElementById('helqAnoBox').appendChild(ano);
        document.getElementById('helqConsultarBox').appendChild(btnConsultar);
        document.getElementById('helqLimparBox').appendChild(btnLimpar);

        // Keep legacy controls in the same form, visually hidden, including layouts
        // without the .style6 heading (the simulator and alternate official markup).
        const originalHidden = document.createElement('div');
        originalHidden.id = 'helqOriginalOculto'; originalHidden.hidden = true;
        originalHidden.style.display = 'none';
        [...form.childNodes].forEach(node => {
            if (node === app || (node.nodeType === Node.ELEMENT_NODE &&
                (node.tagName === 'SCRIPT' || (node.tagName === 'INPUT' && node.type === 'hidden')))) return;
            originalHidden.appendChild(node);
        });
        form.appendChild(originalHidden);

        txtRegistro.setAttribute('autocomplete', 'off');
        txtRegistro.placeholder = 'Ex.: 51518';

        const status = document.getElementById('helqStatus');
        const tabelaWrap = document.getElementById('helqTabelaWrap');
        const tabelaBody = document.getElementById('helqTabelaBody');
        const vazio = document.getElementById('helqSemResultados');
        const legenda = document.getElementById('helqLegenda');
        const copiarResumo = document.getElementById('helqCopiarResumo');

        function mostrarStatus(tipo, texto) {
            status.className = `helq-status visible ${tipo}`;
            status.textContent = texto;
        }

        function limparStatus() {
            status.className = 'helq-status';
            status.textContent = '';
        }

        function escaparHtml(valor) {
            return String(valor ?? '')
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        function renderTabela() {
            tabelaBody.innerHTML = '';
            if (!registros.length) {
                tabelaWrap.style.display = 'none';
                legenda.style.display = 'none';
                copiarResumo.disabled = true;
                vazio.style.display = 'block';
                return;
            }

            tabelaWrap.style.display = 'block';
            legenda.style.display = 'flex';
            copiarResumo.disabled = false;
            vazio.style.display = 'none';

            registros.forEach((r, index) => {
                const tr = document.createElement('tr');
                if (r.fimDeSemana) tr.classList.add('helq-weekend');
                if (r.temHE100) tr.classList.add('helq-he100');
                tr.innerHTML = `
                    <td><input type="checkbox" class="helq-selecao" data-data="${escaparHtml(r.data)}" aria-label="Selecionar ${escaparHtml(r.data)}"></td><td><span class="helq-date-main">${escaparHtml(r.data)}</span><span class="helq-day">· ${escaparHtml(r.diaSemana)}</span></td>
                    <td>${escaparHtml(r.entrada || '—')}</td>
                    <td>${escaparHtml(r.saidaAl || '—')}</td>
                    <td>${escaparHtml(r.retornoAl || '—')}</td>
                    <td>${escaparHtml(r.saida || '—')}</td>
                    <td>${escaparHtml(r.he50 || '00:00')}</td>
                    <td class="${r.temHE100 ? 'helq-he100-value' : ''}">${escaparHtml(r.he100 || '00:00')}</td>
                    <td class="helq-total-dia">${escaparHtml(r.totalDia)}</td>
                    <td>
                        <div class="helq-row-actions">
                            <button type="button" class="helq-row-btn helq-details" data-index="${index}">Detalhes</button>
                            <button type="button" class="helq-row-btn helq-delete" data-index="${index}" title="Excluir o lançamento de ${escaparHtml(r.data)}">🗑 Excluir</button>
                        </div>
                    </td>
                `;
                tabelaBody.appendChild(tr);
            });
        }

        const excluirModal = document.getElementById('helqExcluirModal');
        const detalhesModal = document.getElementById('helqDetalhesModal');
        const btnCancelarExclusao = document.getElementById('helqCancelarExclusao');
        const btnConfirmarExclusao = document.getElementById('helqConfirmarExclusao');
        const btnFecharDetalhes = document.getElementById('helqFecharDetalhes');
        let exclusaoPendente = null;

        function fecharModal(modal) {
            if(excluindoConsulta)return;
            modal.classList.remove('visible');
        }

        function abrirExclusao(r) {
            if(!consultaAtualUtilizavel())return;
            exclusaoPendente = r;
            document.getElementById('helqExServidor').textContent = r.nome || '—';
            document.getElementById('helqExData').textContent = r.data || '—';
            document.getElementById('helqExDia').textContent = r.diaSemana || '—';
            document.getElementById('helqExHorario').textContent = `${r.entrada || '—'}–${r.saidaAl || '—'} / ${r.retornoAl || '—'}–${r.saida || '—'}`;
            document.getElementById('helqEx50').textContent = r.he50 || '00:00';
            document.getElementById('helqEx100').textContent = r.he100 || '00:00';
            document.getElementById('helqExTotal').textContent = r.totalDia || '00:00';
            btnConfirmarExclusao.disabled = false;
            btnConfirmarExclusao.textContent = 'Excluir lançamento';
            excluirModal.classList.add('visible');
            prepararConfirmacao([r]);
            btnCancelarExclusao.focus();
        }

        function abrirDetalhes(r) {
            document.getElementById('helqDetServidor').textContent = r.nome || '—';
            document.getElementById('helqDetRegistro').textContent = r.registro || '—';
            document.getElementById('helqDetPeriodo').textContent = r.periodo || '—';
            document.getElementById('helqDetData').textContent = `${r.data || '—'}${r.diaSemana ? ` · ${r.diaSemana}` : ''}`;
            document.getElementById('helqDetEntrada').textContent = r.entrada || '—';
            document.getElementById('helqDetSaidaAl').textContent = r.saidaAl || '—';
            document.getElementById('helqDetRetorno').textContent = r.retornoAl || '—';
            document.getElementById('helqDetSaida').textContent = r.saida || '—';
            document.getElementById('helqDet50').textContent = r.he50 || '00:00';
            document.getElementById('helqDet100').textContent = r.he100 || '00:00';
            document.getElementById('helqDetTotal').textContent = r.totalDia || '00:00';
            document.getElementById('helqDetAdNoturno').textContent = r.adNoturno || '00:00';
            document.getElementById('helqDetUsuario').textContent = r.usuario || '—';
            detalhesModal.classList.add('visible');
            btnFecharDetalhes.focus();
        }

        tabelaBody.addEventListener('click', e => {
            const btn = e.target.closest('button[data-index]');
            if (!btn) return;
            ultimoFocoConsulta=btn;
            const r = registros[Number(btn.dataset.index)];
            if (!r) return;
            if (btn.classList.contains('helq-delete')) abrirExclusao(r);
            if (btn.classList.contains('helq-details')) abrirDetalhes(r);
        });

        btnCancelarExclusao.addEventListener('click', () => fecharModal(excluirModal));
        btnFecharDetalhes.addEventListener('click', () => fecharModal(detalhesModal));
        [excluirModal, detalhesModal].forEach(modal => {
            modal.addEventListener('click', e => {
                if (e.target === modal) fecharModal(modal);
            });
        });
        document.addEventListener('keydown', e => {
            if (e.key !== 'Escape') return;
            if (excluirModal.classList.contains('visible')) fecharModal(excluirModal);
            if (detalhesModal.classList.contains('visible')) fecharModal(detalhesModal);
        });

        btnConfirmarExclusao.addEventListener('click', excluirSelecionadosConfirmados);

        async function copiarTexto(texto) {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(texto);
                return;
            }
            const area = document.createElement('textarea');
            area.value = texto;
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            const ok = document.execCommand('copy');
            area.remove();
            if (!ok) throw new Error('Falha ao copiar');
        }

        function montarResumo() {
            const linhas = [
                'CONSULTA DE HORAS EXTRAS',
                `Servidor: ${servidorNome}`,
                `Registro: ${servidorRegistro}`,
                `Período da folha: ${periodoAtual()}`,
                `Lançamentos: ${registros.length}`,
                `HE 50%: ${total50}`,
                `HE 100%: ${total100}`,
                `Total geral: ${totalGeral}`
            ];

            if (registros.length) {
                linhas.push('', 'Lançamentos:');
                registros.forEach(r => {
                    linhas.push(`${r.data} (${r.diaSemana}) | ${r.entrada}-${r.saida} | HE50 ${r.he50} | HE100 ${r.he100} | Total ${r.totalDia}`);
                });
            }
            return linhas.join('\n');
        }

        copiarResumo.addEventListener('click', async () => {
            const textoOriginal = copiarResumo.textContent;
            try {
                await copiarTexto(montarResumo());
                copiarResumo.textContent = 'Copiado ✓';
                mostrarStatus('success', 'Resumo copiado para a área de transferência.');
            } catch (erro) {
                mostrarStatus('warning', 'Não foi possível copiar automaticamente. Tente novamente ou copie os dados manualmente.');
            } finally {
                setTimeout(() => { copiarResumo.textContent = textoOriginal; }, 1600);
            }
        });

        let excluindoConsulta=false,consultaVerificada=false;
        const contextoConsulta={rf:txtRegistro.value.trim(),mes:mes.value,ano:String(ano.value)};
        const selecionadosConsulta=new Set();let registrosConfirmacao=[],ultimoFocoConsulta=null;
        const normalizarRFConsulta=v=>String(v||'').trim().replace(/^0+(?=\d)/,'');
        const mesmoContextoConsulta=()=>normalizarRFConsulta(txtRegistro.value)===normalizarRFConsulta(contextoConsulta.rf)&&mes.value===contextoConsulta.mes&&String(ano.value)===contextoConsulta.ano;
        const segundosConsulta=v=>{v=String(v||'').trim();if(!duracaoRetornadaValida(v))throw Error('Horas inválidas na consulta');const a=v.split(':').map(Number);return a[0]*3600+a[1]*60+(a[2]||0);};
        const totalSegundosConsulta=v=>{v=String(v||'').trim();if(/^\d+(?:[.,]\d+)?$/.test(v))return Math.round(Number(v.replace(',','.'))*3600);return segundosConsulta(v);};
        function validarDocumentoConsulta(doc,ctx) {
            if(normalizarRFConsulta(doc.querySelector('#TextBox1')?.value)!==normalizarRFConsulta(ctx.rf)||doc.querySelector('#DropDownList1')?.value!==ctx.mes||String(doc.querySelector('#anoPeriodo')?.value)!==ctx.ano)throw Error('A consulta pertence a outro servidor ou período');
            const grid=doc.querySelector('#GridView1'),mapa=new Map();let s50=0,s100=0;
            if(grid){
                const esperado=['registro','nome','periodo','data','entrada','saidaal','retornoal','saida','he50','he100','adnoturno','usuario'];
                if(!grid.rows.length||[...grid.rows[0].cells].map(c=>c.textContent.trim().toLowerCase()).join('|')!==esperado.join('|'))throw Error('Tabela desconhecida');
                if([...grid.querySelectorAll('a')].some(a=>/Page\$/i.test(a.getAttribute('href')||'')))throw Error('A consulta está paginada; não foi possível conferir todos os dias');
                for(const tr of [...grid.rows].slice(1)){
                    const c=[...tr.cells].map(c=>c.textContent.trim()),data=normalizarData(c[3]),dt=dataParaDate(data);
                    if(c.length!==12||normalizarRFConsulta(c[0])!==normalizarRFConsulta(ctx.rf)||c[2]!==ctx.mes||!dt||mapa.has(data))throw Error('Registro inconsistente ou repetido');
                    if(!c.slice(4,8).every(v=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v))||!duracaoRetornadaValida(c[10]))throw Error('Horários ou adicional noturno inválidos na consulta');
                    const a=segundosConsulta(c[8]),b=segundosConsulta(c[9]);s50+=a;s100+=b;
                    mapa.set(data,{registro:c[0],nome:c[1],periodo:c[2],data,dataObj:dt,diaSemana:DIAS_SEMANA[dt.getDay()],fimDeSemana:[0,6].includes(dt.getDay()),entrada:c[4],saidaAl:c[5],retornoAl:c[6],saida:c[7],he50:c[8],he100:c[9],totalDia:minutosParaDuracao((a+b)/60),totalDiaMin:(a+b)/60,temHE100:b>0,adNoturno:c[10],usuario:c[11]});
                }
            }
            const l50=doc.querySelector('#L50'),l100=doc.querySelector('#L100');
            if(!l50||!l100||totalSegundosConsulta(l50.textContent)!==s50||totalSegundosConsulta(l100.textContent)!==s100)throw Error('Os totais não correspondem aos registros; a consulta pode estar incompleta');
            return mapa;
        }
        function consultaAtualUtilizavel() {
            if(excluindoConsulta)return false;
            if(!consultaVerificada||!mesmoContextoConsulta()){mostrarStatus('warning','Filtros alterados ou consulta não confirmada. Clique em Consultar antes de excluir.');return false;}
            return true;
        }
        function atualizarSelecaoConsulta() {
            const valido=consultaVerificada&&mesmoContextoConsulta()&&!excluindoConsulta;
            document.getElementById('helqSelecaoResumo').textContent=selecionadosConsulta.size+' selecionado(s)';
            document.getElementById('helqExcluirSelecionados').disabled=!valido||!selecionadosConsulta.size;
            const todos=document.getElementById('helqSelecionarTodos');todos.disabled=!valido||!registros.length;todos.checked=registros.length>0&&selecionadosConsulta.size===registros.length;todos.indeterminate=selecionadosConsulta.size>0&&selecionadosConsulta.size<registros.length;
            tabelaBody.querySelectorAll('.helq-selecao,.helq-delete').forEach(el=>el.disabled=!valido);
        }
        function prepararConfirmacao(rs) {
            if(!consultaAtualUtilizavel())return;
            registrosConfirmacao=rs.map(r=>({...r}));
            document.getElementById('helqExRF').textContent=contextoConsulta.rf;
            document.getElementById('helqExFolha').textContent=contextoConsulta.mes+'/'+contextoConsulta.ano;
            document.getElementById('helqExcluirTitulo').textContent=rs.length===1?'Deseja realmente excluir este dia?':'Deseja realmente excluir estes '+rs.length+' dias?';
            document.getElementById('helqExServidor').textContent=rs[0].nome;
            document.getElementById('helqExData').textContent=rs.length===1?rs[0].data:rs.length+' dias selecionados';
            document.getElementById('helqExDia').textContent=rs.length===1?rs[0].diaSemana:'Veja a lista abaixo';
            document.getElementById('helqExHorario').textContent=rs.length===1?rs[0].entrada+'–'+rs[0].saidaAl+' / '+rs[0].retornoAl+'–'+rs[0].saida:'Veja a lista abaixo';
            document.getElementById('helqEx50').textContent=minutosParaDuracao(rs.reduce((s,r)=>s+segundosConsulta(r.he50),0)/60);
            document.getElementById('helqEx100').textContent=minutosParaDuracao(rs.reduce((s,r)=>s+segundosConsulta(r.he100),0)/60);
            document.getElementById('helqExTotal').textContent=minutosParaDuracao(rs.reduce((s,r)=>s+r.totalDiaMin,0));
            document.getElementById('helqListaExcluir').innerHTML=rs.map(r=>'<div><strong>'+escaparHtml(r.data)+'</strong><span>'+escaparHtml(r.entrada+'–'+r.saidaAl+' / '+r.retornoAl+'–'+r.saida)+'</span><b>HE '+escaparHtml(r.totalDia)+'</b></div>').join('');
            const noturno=rs.reduce((sum,r)=>sum+segundosConsulta(r.adNoturno||'00:00'),0);let n=document.getElementById('helqExNoturno');if(!n){n=document.createElement('div');n.id='helqExNoturno';n.style.cssText='font-size:12px;color:#7d2020';document.getElementById('helqListaExcluir').before(n);}n.hidden=!noturno;n.textContent=noturno?'Estes lançamentos também contêm '+minutosParaDuracao(noturno/60)+' de adicional noturno, que será excluído.':'';
            document.getElementById('helqExProgresso').textContent='';btnCancelarExclusao.textContent='Cancelar';
            btnConfirmarExclusao.disabled=false;btnConfirmarExclusao.textContent=window.__HEL_SIMULACAO__?'Excluir da simulação':'Excluir lançamento(s)';excluirModal.classList.add('visible');btnCancelarExclusao.focus();
        }
        async function buscarConsultaDocumento(url,opcoes={}) {
            const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),20000);
            try{const res=await fetch(url,{...opcoes,credentials:'same-origin',signal:abort.signal});if(!res.ok)throw Error('Falha na consulta');if(res.url&&new URL(res.url).pathname.toLowerCase()!==new URL(url).pathname.toLowerCase())throw Error('Sessão redirecionada');const doc=new DOMParser().parseFromString(await res.text(),'text/html');if(!doc.querySelector('#form1')||!doc.querySelector('input[name="__VIEWSTATE"]')?.value||!doc.querySelector('input[name="__EVENTVALIDATION"]')?.value)throw Error('Sessão inválida ou resposta inesperada');return doc;}finally{clearTimeout(timer);}
        }
        async function reconsultarContexto() {
            if(window.__HEL_SIMULACAO__){
                if(window.__HEL_SIM_FALHA_CONSULTA__)throw Error('Consulta simulada indisponível');
                const base=JSON.parse(localStorage.getItem('pg_he_beta45_sim_base')||'[]'),mapa=new Map();
                for(const r of base.filter(r=>normalizarRFConsulta(r.rf)===normalizarRFConsulta(contextoConsulta.rf)&&r.periodo===contextoConsulta.mes&&String(r.ano)===contextoConsulta.ano)){
                    if(mapa.has(r.data)||!dataParaDate(r.data))throw Error('Registro repetido ou inválido');const dt=dataParaDate(r.data),a=segundosConsulta(r.he50),b=segundosConsulta(r.he100);
                    mapa.set(r.data,{...r,registro:r.rf,retornoAl:r.retorno,dataObj:dt,diaSemana:DIAS_SEMANA[dt.getDay()],fimDeSemana:[0,6].includes(dt.getDay()),totalDia:minutosParaDuracao((a+b)/60),totalDiaMin:(a+b)/60,temHE100:b>0});
                }return {mapa};
            }
            const url=location.href,doc=await buscarConsultaDocumento(url),f=doc.querySelector('#form1'),action=new URL(f.getAttribute('action')||url,url);
            if(action.origin!==location.origin||action.pathname.toLowerCase()!==location.pathname.toLowerCase())throw Error('Destino de consulta inesperado');
            const p=new URLSearchParams(new FormData(f));['btnExcluir','btnLimpar','Button1'].forEach(k=>p.delete(k));p.set('__EVENTTARGET','');p.set('__EVENTARGUMENT','');p.set('TextBox1',normalizarRFConsulta(contextoConsulta.rf));p.set('DropDownList1',contextoConsulta.mes);p.set('anoPeriodo',contextoConsulta.ano);p.set('TextBox2','');p.set('Button1',doc.querySelector('#Button1')?.value||'Consultar');
            const resposta=await buscarConsultaDocumento(action.href,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},body:p.toString()});return {mapa:validarDocumentoConsulta(resposta,contextoConsulta),doc:resposta,action:action.href};
        }
        const assinaturaConsulta=r=>JSON.stringify([r?.registro&&normalizarRFConsulta(r.registro),r?.nome,r?.data,r?.entrada,r?.saidaAl,r?.retornoAl,r?.saida,r?.he50,r?.he100,segundosConsulta(r?.adNoturno||'00:00')]);
        function aplicarResultadoConsulta(resultado) {
            registros=[...resultado.mapa.values()].sort((a,b)=>a.dataObj-b.dataObj);
            total50=minutosParaDuracao(registros.reduce((s,r)=>s+segundosConsulta(r.he50),0)/60);total100=minutosParaDuracao(registros.reduce((s,r)=>s+segundosConsulta(r.he100),0)/60);totalGeral=minutosParaDuracao(registros.reduce((s,r)=>s+r.totalDiaMin,0));
            ['50','100','Geral'].forEach(k=>document.getElementById('helqTotal'+k).textContent=k==='50'?total50:k==='100'?total100:totalGeral);
            document.getElementById('helqContagem').textContent=registros.length;document.getElementById('helqTituloContagem').textContent=registros.length+' lançamento(s)';
            if(resultado.doc)resultado.doc.querySelectorAll('input[type="hidden"][name]').forEach(n=>{const destino=[...form.querySelectorAll('input[type="hidden"]')].find(x=>x.name===n.name);if(destino)destino.value=n.value;});
            renderTabela();tabelaBody.querySelectorAll('.helq-selecao').forEach(el=>el.checked=selecionadosConsulta.has(el.dataset.data));vazio.textContent='Nenhum lançamento encontrado para este servidor e período.';
        }
        async function excluirSelecionadosConfirmados() {try{return await executarOperacaoExclusivaHE(()=>excluirSelecionadosConfirmadosProtegido());}catch(e){mostrarStatus('warning',e.message);document.getElementById('helqExProgresso').textContent=e.message;}}
    async function excluirSelecionadosConfirmadosProtegido() {
            if(!consultaAtualUtilizavel()||!registrosConfirmacao.length)return;
            const fila=registrosConfirmacao.slice();excluindoConsulta=true;btnConfirmarExclusao.disabled=true;btnCancelarExclusao.disabled=true;txtRegistro.disabled=true;mes.disabled=true;ano.disabled=true;btnConsultar.disabled=true;btnLimpar.disabled=true;atualizarSelecaoConsulta();let concluidos=0,erro='',historicoFalhou=false;
            try{
                for(const r of fila){
                    if(!mesmoContextoConsulta())throw Error('Os filtros foram alterados. Consulte novamente.');
                    document.getElementById('helqExProgresso').textContent='Conferindo '+r.data+' · '+concluidos+'/'+fila.length+' excluído(s)';
                    const fresco=await reconsultarContexto(),atual=fresco.mapa.get(r.data);
                    if(!atual||assinaturaConsulta(atual)!==assinaturaConsulta(r))throw Error('O lançamento de '+r.data+' mudou ou não aparece mais. Nenhuma exclusão foi enviada para esse dia.');
                    let p;if(!window.__HEL_SIMULACAO__){const f=fresco.doc.querySelector('#form1'),b=fresco.doc.querySelector('#btnExcluir');if(!b||b.disabled||!f.querySelector('#TextBox2')||f.querySelector('#TextBox2').disabled)throw Error('Exclusão não disponível');p=new URLSearchParams(new FormData(f));['Button1','btnLimpar','btnExcluir'].forEach(k=>p.delete(k));p.set('__EVENTTARGET','');p.set('__EVENTARGUMENT','');p.set('TextBox1',normalizarRFConsulta(contextoConsulta.rf));p.set('DropDownList1',contextoConsulta.mes);p.set('anoPeriodo',contextoConsulta.ano);p.set('TextBox2',r.data);p.set('btnExcluir',b.value||'Excluir');}
                    const operacaoExclusao=registrarExclusaoHE({rf:contextoConsulta.rf,nome:r.nome},{nome:contextoConsulta.mes,ano:contextoConsulta.ano},r);
                    try{sessionStorage.setItem(DELETE_PENDING_KEY,JSON.stringify({registro:contextoConsulta.rf,nome:r.nome,data:r.data,periodo:contextoConsulta.mes,ano:contextoConsulta.ano,ts:Date.now()}));}catch{}
                    consultaVerificada=false;
                    try{
                        if(window.__HEL_SIMULACAO__){if(window.__HEL_SIM_EXCLUSAO__==='falha-sem-excluir'||window.__HEL_SIM_EXCLUSAO_FALHAR_DATA__===r.data)throw Error('Falha simulada');const k='pg_he_beta45_sim_base',a=JSON.parse(localStorage.getItem(k)||'[]').filter(x=>!(normalizarRFConsulta(x.rf)===normalizarRFConsulta(contextoConsulta.rf)&&x.periodo===contextoConsulta.mes&&String(x.ano)===contextoConsulta.ano&&x.data===r.data));localStorage.setItem(k,JSON.stringify(a));if(window.__HEL_SIM_EXCLUSAO__==='falha-apos-excluir')throw Error('Resposta perdida');}
                        else await buscarConsultaDocumento(fresco.action,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded; charset=UTF-8'},body:p.toString()});
                    }catch{/* Verify exactly once without another delete POST. */}
                    const depois=await reconsultarContexto();if(!mesmoContextoConsulta())throw Error('Contexto alterado durante a verificação');consultaVerificada=true;aplicarResultadoConsulta(depois);
                    if(depois.mapa.has(r.data))throw Error('A exclusão de '+r.data+' não foi confirmada. Os demais dias não serão enviados.');
                    selecionadosConsulta.delete(r.data);concluidos++;try{sessionStorage.removeItem(DELETE_PENDING_KEY);}catch{}
                    try{concluirExclusaoHE(operacaoExclusao);}catch{historicoFalhou=true;}
                }
            }catch(e){erro=e.message;}
            finally{
                excluindoConsulta=false;txtRegistro.disabled=false;mes.disabled=false;ano.disabled=false;btnConsultar.disabled=false;btnLimpar.disabled=false;btnCancelarExclusao.disabled=false;atualizarSelecaoConsulta();
                if(!consultaVerificada){['helqTotal50','helqTotal100','helqTotalGeral','helqContagem'].forEach(id=>document.getElementById(id).textContent='—');document.getElementById('helqTituloContagem').textContent='Atualização necessária';tabelaWrap.classList.add('helq-filter-dirty');copiarResumo.disabled=true;}
                const texto=concluidos+' de '+fila.length+' dia(s) excluído(s) e conferido(s).'+(erro?' Lote interrompido: '+erro+' Consulte novamente antes de tentar os dias restantes.':'')+(historicoFalhou?' O histórico não pôde ser salvo neste navegador.':'');
                document.getElementById('helqExProgresso').textContent=texto;mostrarStatus(erro||historicoFalhou?'warning':'success',texto);if(!erro)fecharModal(excluirModal);btnCancelarExclusao.textContent=erro?'Fechar':'Cancelar';renderRecuperacaoConsultaHE();
            }
        }
        let renderRecuperacaoConsultaHE=()=>{};
        function iniciarMelhoriasConsulta() {
            const cssDetalhes=document.createElement('style');cssDetalhes.textContent="#helqDetalhesModal{padding:12px;box-sizing:border-box;overflow:hidden}#helqDetalhesModal.visible{display:flex;align-items:center;justify-content:center}#helqDetalhesModal .helq-modal{width:min(680px,100%);max-height:calc(100dvh - 24px);margin:0;display:flex;flex-direction:column;min-height:0;font-family:Arial,Helvetica,sans-serif}#helqDetalhesModal .helq-modal-head,#helqDetalhesModal .helq-modal-actions{flex:none}#helqDetalhesModal .helq-modal-body{padding:14px;overflow:auto;min-height:0}.helq-det-person{display:flex;flex-direction:column;gap:4px;font-size:12px;color:#465866}.helq-det-person>strong{font-size:16px;color:#244866}.helq-det-person b{color:#244866;font-size:13px;font-weight:600}.helq-det-caption,.helq-det-identificacao span{font-size:11px;color:#59666f}.helq-det-identificacao{display:grid;grid-template-columns:80px minmax(130px,1fr) minmax(150px,1.3fr);gap:12px;margin-top:6px}.helq-det-identificacao>div{display:flex;flex-direction:column;gap:3px}.helq-det-section{margin-top:12px;border-top:1px solid #d4dce3;padding-top:9px}.helq-det-section h3{font-size:12px;margin:0 0 7px;color:#465866}.helq-det-values{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.helq-det-values>div{display:flex;flex-direction:column;gap:4px;background:#f4f6f8;padding:8px;border-radius:2px}.helq-det-values span{font-size:11px;color:#59666f}.helq-det-values strong{font-size:15px;color:#244866}.helq-det-user{margin-top:12px;font-size:12px;color:#59666f}.helq-det-person,.helq-det-user{overflow-wrap:anywhere}@media(max-width:500px){.helq-det-identificacao{grid-template-columns:80px minmax(0,1fr);gap:8px}.helq-det-data{grid-column:1/-1}.helq-det-values{grid-template-columns:repeat(2,minmax(0,1fr))}}";document.head.appendChild(cssDetalhes);
            inserirCreditosHE(app);
            renderRecuperacaoConsultaHE=criarRecuperacaoExclusoesHE(app,()=>txtRegistro.value,async op=>{if(!mesmoContextoConsulta()||normalizarRFConsulta(op.rf)!==normalizarRFConsulta(contextoConsulta.rf)||op.periodo.nome!==contextoConsulta.mes||String(op.periodo.ano)!==String(contextoConsulta.ano))throw Error('Consulte a folha '+op.periodo.nome+'/'+op.periodo.ano+' do RF '+op.rf+' antes de conferir essa exclusão.');return (await reconsultarContexto()).mapa;},mostrarStatus,()=>excluindoConsulta);

            const css=document.createElement('style');css.textContent='.helq-modal{font-family:Arial,sans-serif}.helq-modal-warning{font-weight:400}#helqExcluirModal{padding:12px;box-sizing:border-box;overflow:hidden}#helqExcluirModal.visible{display:flex;align-items:center;justify-content:center}#helqExcluirModal .helq-modal{width:min(720px,100%);max-width:720px;max-height:calc(100dvh - 24px);margin:0;display:flex;flex-direction:column;min-height:0}#helqExcluirModal .helq-modal-head,#helqExcluirModal .helq-modal-actions{flex:none}#helqExcluirModal .helq-modal-body{display:flex;flex-direction:column;min-height:0;padding:12px;gap:10px}#helqExcluirModal .helq-modal-warning{margin:0;padding:7px 10px;flex:none}.helq-ex-summary{flex:none}.helq-ex-person{display:flex;flex-direction:column;gap:4px}.helq-ex-person small,.helq-ex-totals small{color:#59666f;font-size:11px}.helq-ex-person strong{font-size:15px}.helq-ex-person span{font-size:12px;color:#526273}.helq-ex-totals{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}.helq-ex-totals>div{background:#f2f4f5;padding:7px 9px;display:flex;flex-direction:column;gap:3px}.helq-ex-totals>div:last-child{background:#edf3f8}.helq-ex-list-title{font-size:12px;font-weight:700;flex:none}#helqListaExcluir{margin:0;max-height:320px;overflow:auto;min-height:0;flex:0 1 auto;border:1px solid #d1d5d8}#helqListaExcluir>div{display:grid;grid-template-columns:100px 1fr 80px;gap:8px;padding:7px 9px;border-bottom:1px solid #e5e7eb;font-size:12px;align-items:center}#helqListaExcluir>div:last-child{border-bottom:0}#helqListaExcluir b{text-align:right;white-space:nowrap}#helqExProgresso{margin:0;flex:none}#helqExProgresso:empty{display:none}@media(max-width:500px){#helqListaExcluir>div{grid-template-columns:1fr auto}#helqListaExcluir>div span{grid-column:1/-1;grid-row:2}.helq-ex-totals{gap:4px}.helq-ex-totals>div{padding:6px}}#helqExProgresso{font-size:12px;color:#526273}.helq-modal-grid .value{overflow-wrap:anywhere}.helq-filter-dirty{opacity:.6}@media(max-width:650px){.helq-table{min-width:0}.helq-table th,.helq-table td{padding:6px 4px}.helq-summary-grid{grid-template-columns:1fr 1fr}.helq-person{grid-column:1/-1}.helq-row-actions{flex-direction:column}.helq-day{display:block}.helq-table th:nth-child(7),.helq-table th:nth-child(8),.helq-table td:nth-child(7),.helq-table td:nth-child(8){display:none}.helq-table th:nth-child(n+3):nth-child(-n+6),.helq-table td:nth-child(n+3):nth-child(-n+6){display:none}}';document.head.appendChild(css);
            const grid=excluirModal.querySelector('.helq-modal-grid');grid.className='helq-ex-summary';grid.innerHTML='<div class="helq-ex-person"><small>Servidor</small><strong id="helqExServidor"></strong><span>RF <b id="helqExRF"></b> · Folha <b id="helqExFolha"></b></span></div><div class="helq-ex-totals"><div><small>HE 50%</small><b id="helqEx50"></b></div><div><small>HE 100%</small><b id="helqEx100"></b></div><div><small>Total selecionado</small><b id="helqExTotal"></b></div></div><span hidden id="helqExData"></span><span hidden id="helqExDia"></span><span hidden id="helqExHorario"></span>';grid.insertAdjacentHTML('afterend','<div class="helq-ex-list-title">Dias selecionados e horários</div><div id="helqListaExcluir" tabindex="0" aria-label="Dias selecionados para exclusão"></div><p id="helqExProgresso" role="status"></p>');excluirModal.querySelector('.helq-modal-warning').textContent='Confira os dias selecionados antes de excluir.';status.setAttribute('role','status');
            try{const mapa=validarDocumentoConsulta(document,contextoConsulta);consultaVerificada=true;aplicarResultadoConsulta({mapa});if(!registros.length)mostrarStatus('info',contextoConsulta.rf?'Nenhum lançamento encontrado para este servidor e período.':'Informe o registro e o período para consultar.');}
            catch(e){consultaVerificada=false;document.getElementById('helqTotal50').textContent='—';document.getElementById('helqTotal100').textContent='—';document.getElementById('helqTotalGeral').textContent='—';document.getElementById('helqContagem').textContent='—';document.getElementById('helqTituloContagem').textContent='Dados não confirmados';tabelaWrap.style.display='none';vazio.style.display='none';copiarResumo.disabled=true;mostrarStatus('warning','Consulta não confirmada: '+e.message+'. Consulte novamente antes de usar os resultados.');}
            const mudou=()=>{selecionadosConsulta.clear();tabelaBody.querySelectorAll('.helq-selecao').forEach(el=>el.checked=false);tabelaWrap.classList.toggle('helq-filter-dirty',!mesmoContextoConsulta());if(!mesmoContextoConsulta())mostrarStatus('warning','Filtros alterados. Clique em Consultar para atualizar os resultados.');else if(consultaVerificada)limparStatus();atualizarSelecaoConsulta();};
            [txtRegistro,mes,ano].forEach(el=>{el.addEventListener('input',mudou);el.addEventListener('change',mudou);});
            tabelaBody.addEventListener('change',e=>{if(!e.target.matches('.helq-selecao'))return;if(e.target.checked)selecionadosConsulta.add(e.target.dataset.data);else selecionadosConsulta.delete(e.target.dataset.data);atualizarSelecaoConsulta();});
            document.getElementById('helqSelecionarTodos').onchange=e=>{selecionadosConsulta.clear();if(e.target.checked)registros.forEach(r=>selecionadosConsulta.add(r.data));tabelaBody.querySelectorAll('.helq-selecao').forEach(el=>el.checked=e.target.checked);atualizarSelecaoConsulta();};
            document.getElementById('helqExcluirSelecionados').onclick=()=>{ultimoFocoConsulta=document.getElementById('helqExcluirSelecionados');prepararConfirmacao(registros.filter(r=>selecionadosConsulta.has(r.data)));};
            form.addEventListener('submit',e=>{if(excluindoConsulta){e.preventDefault();return;}if(e.submitter===btnConsultar)mostrarStatus('info','Consultando… aguarde os resultados.');});
            [excluirModal,detalhesModal].forEach(m=>new MutationObserver(()=>{if(!m.classList.contains('visible')){const t=ultimoFocoConsulta?.isConnected&&!ultimoFocoConsulta.disabled?ultimoFocoConsulta:btnConsultar;t.focus();}}).observe(m,{attributes:true,attributeFilter:['class']}));
            document.addEventListener('keydown',e=>{if(e.key!=='Tab')return;const m=[excluirModal,detalhesModal].find(m=>m.classList.contains('visible'));if(!m)return;const a=[...m.querySelectorAll('button,input,select,textarea,a[href],summary,[tabindex]:not([tabindex="-1"])')].filter(x=>!x.disabled&&x.getClientRects().length);if(!a.length){e.preventDefault();return;}if(!m.contains(document.activeElement)||(e.shiftKey&&document.activeElement===a[0])||(!e.shiftKey&&document.activeElement===a[a.length-1])){e.preventDefault();(e.shiftKey?a[a.length-1]:a[0]).focus();}});
            atualizarSelecaoConsulta();
        }



        function conferirExclusaoAnterior() {
            let pendente;
            try {pendente=JSON.parse(sessionStorage.getItem(DELETE_PENDING_KEY)||'null');}catch{return;}
            if(!pendente)return;
            if(Date.now()-Number(pendente.ts||0)>10*60*1000){sessionStorage.removeItem(DELETE_PENDING_KEY);return;}
            const rf=v=>String(v||'').trim().replace(/^0+(?=\d)/,'');
            if(!pendente.ano || rf(txtRegistro.value)!==rf(pendente.registro) || mes.value!==pendente.periodo || String(ano.value)!==String(pendente.ano)){
                mostrarStatus('info','A exclusão ainda precisa ser conferida na folha '+pendente.periodo+'/'+(pendente.ano||'ano não informado')+' do RF '+pendente.registro+'. Consulte esse período antes de concluir.');return;
            }
            try {
                const grid=document.getElementById('GridView1'),cabecalho=['Registro','nome','Periodo','data','entrada','SaidaAl','RetornoAl','saida','HE50','HE100','AdNoturno','usuario'];
                const seg=v=>{v=String(v||'').trim();if(!duracaoRetornadaValida(v))throw Error('Horas inválidas');const a=v.split(':').map(Number);return a[0]*3600+a[1]*60+(a[2]||0);};
                const total=v=>{v=String(v||'').trim();if(/^\d+(?:[.,]\d+)?$/.test(v))return Math.round(Number(v.replace(',','.'))*3600);return seg(v);};
                let s50=0,s100=0;const datas=new Set();
                if(grid){
                    if([...grid.querySelectorAll('a')].some(a=>/Page\$/i.test(a.getAttribute('href')||'')))throw Error('Consulta paginada');
                    if([...grid.rows[0].cells].map(c=>c.textContent.trim().toLowerCase()).join('|')!==cabecalho.map(c=>c.toLowerCase()).join('|'))throw Error('Tabela desconhecida');
                    for(const tr of [...grid.rows].slice(1)){
                        const c=[...tr.cells].map(c=>c.textContent.trim());const d=normalizarData(c[3]);
                        if(c.length!==12||rf(c[0])!==rf(pendente.registro)||c[2]!==pendente.periodo||!dataParaDate(d)||datas.has(d))throw Error('Dados inconsistentes');
                        datas.add(d);s50+=seg(c[8]);s100+=seg(c[9]);
                    }
                }
                const l50=document.getElementById('L50'),l100=document.getElementById('L100');
                if(!l50||!l100||total(l50.textContent)!==s50||total(l100.textContent)!==s100)throw Error('Totais incompletos');
                sessionStorage.removeItem(DELETE_PENDING_KEY);
                mostrarStatus(datas.has(pendente.data)?'warning':'success',datas.has(pendente.data)?'O lançamento ainda aparece na consulta. A exclusão não foi confirmada; confira antes de tentar novamente.':'Lançamento de '+pendente.data+' excluído com sucesso.');
            }catch(e){mostrarStatus('warning','A consulta não permite confirmar a exclusão. Consulte novamente o mesmo servidor e período.');}
        }

        // Mantém o texto dos botões originais, mas a estilização passa a ser da interface nova.
        btnConsultar.value = 'Consultar';
        btnLimpar.value = 'Limpar';

        renderTabela();
        iniciarMelhoriasConsulta();
        conferirExclusaoAnterior();

        console.log(`[HE Consulta] Versão 4.6 beta 18 carregada. ${registros.length} lançamento(s) renderizado(s).`);
    }

})();

