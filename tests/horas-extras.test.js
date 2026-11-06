const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const script = fs.readFileSync(path.join(__dirname, '..', 'Horas_Extras_v4_6_BETA.user.js'), 'utf8');
const meses = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const opcoes = (valores, selecionado) => valores.map(valor => `<option value="${valor}"${valor === selecionado ? ' selected' : ''}>${valor}</option>`).join('');
const campo = (id, valor = '') => `<input id="${id}" name="${id}" value="${valor}">`;

function cadastro(parametros = new URLSearchParams(), calculado = false, cenario = {}) {
    const carga = parametros.get('DropDownList2') || '04:00';
    return `<!doctype html><html><body><form id="form1" action="CadastroHoras.aspx">
        <input name="__VIEWSTATE" value="estado"><input name="__EVENTVALIDATION" value="evento">
        <div id="Panel1"><span class="style6">CADASTRO DE HORAS EXTRAS</span><a id="HyperLink1" href="PrincipalDoUsuario.aspx">Voltar</a>
        ${campo('txtServidor', parametros.get('txtServidor') || '')}${campo('txtReg', parametros.get('txtReg') || '123456')}
        <select id="DropDownList1" name="DropDownList1">${opcoes(meses, parametros.get('DropDownList1') || 'Novembro')}</select>
        <select id="anoPeriodo" name="anoPeriodo">${opcoes(['2026', '2027'], parametros.get('anoPeriodo') || '2026')}</select>
        <select id="DropDownList2" name="DropDownList2">${opcoes(['-', '04:00', '06:00', '08:00', '12:00'], carga)}</select>
        ${['txtData', 'txtEntrada', 'txtSaidaAl', 'txtRetornoAl', 'txtSaida'].map(id => campo(id, parametros.get(id) || '')).join('')}
        ${campo('txtHE50', calculado ? cenario.he50 || '00:00:00' : '')}
        ${campo('txtHE100', calculado ? cenario.he100 || '00:00:00' : '')}
        <input type="submit" id="Button1" name="Button1" value="Calcular Horas">
        <input type="submit" id="btIncluir" name="btIncluir" value="Incluir">
        </div></form></body></html>`;
}

function consulta(parametros = new URLSearchParams(), registro = null, cenario = {}) {
    const intervalo = valor => cenario.marcadorVazio && !valor ? '&mdash;' : valor || '';
    const tabela = registro ? `<table id="GridView1"><tr><th>Registro</th><th>nome</th><th>Periodo</th><th>data</th><th>entrada</th><th>SaidaAl</th><th>RetornoAl</th><th>saida</th><th>HE50</th><th>HE100</th><th>AdNoturno</th><th>usuario</th></tr>
        <tr><td>123456</td><td>Servidor Teste</td><td>Novembro</td><td>${registro.get('txtData')}</td>
        <td>${registro.get('txtEntrada')}</td><td>${intervalo(registro.get('txtSaidaAl'))}</td>
        <td>${intervalo(registro.get('txtRetornoAl'))}</td><td>${registro.get('txtSaida')}</td>
        <td>${cenario.he50 || '00:00'}</td><td>${cenario.he100 || '00:00'}</td><td>00:00</td><td>Teste</td></tr></table>` : '';
    return `<!doctype html><html><body><form id="form1" action="ConsultaRegistro.aspx">
        <input name="__VIEWSTATE" value="estado"><input name="__EVENTVALIDATION" value="evento">
        ${campo('TextBox1', parametros.get('TextBox1') || '')}${campo('TextBox2')}
        <select id="DropDownList1" name="DropDownList1">${opcoes(meses, parametros.get('DropDownList1') || 'Novembro')}</select>
        <select id="anoPeriodo" name="anoPeriodo">${opcoes(['2026', '2027'], parametros.get('anoPeriodo') || '2026')}</select>
        <input type="submit" id="Button1" name="Button1" value="Consultar">
        <input id="btnLimpar" name="btnLimpar" value="Limpar"><input id="btnExcluir" name="btnExcluir" value="Excluir">
        ${tabela}<span id="L50">${registro ? cenario.he50 || '00:00' : '00:00'}</span>
        <span id="L100">${registro ? cenario.he100 || '00:00' : '00:00'}</span>
        </form></body></html>`;
}

async function abrirCenario(browser, cenario) {
    const contexto = await browser.newContext({ locale: 'pt-BR' });
    const pagina = await contexto.newPage();
    const erros = [], posts = [];
    let registro = cenario.preexistente ? new URLSearchParams({
        txtData: cenario.data, txtEntrada: cenario.entrada, txtSaidaAl: cenario.saidaAl,
        txtRetornoAl: cenario.retorno, txtSaida: cenario.saida
    }) : null;
    pagina.on('pageerror', erro => erros.push(erro.message));
    pagina.on('dialog', dialogo => dialogo.accept());
    await pagina.route('**/folha/CadastroHoras.aspx', async rota => {
        const req = rota.request(), p = new URLSearchParams(req.postData() || '');
        if (req.method() === 'POST') posts.push(p);
        if (p.has('btIncluir')) registro = p;
        let html = cadastro(p, req.method() === 'POST' && !p.has('btIncluir'), cenario);
        if (p.has('btIncluir')) html = html.replace('</body>', "<script>alert('Dados incluídos com sucesso')</script></body>");
        await rota.fulfill({ status: 200, contentType: 'text/html', body: html });
    });
    await pagina.route('**/folha/ConsultaRegistro.aspx', async rota => {
        const p = new URLSearchParams(rota.request().postData() || '');
        await rota.fulfill({ status: 200, contentType: 'text/html', body: consulta(p, registro, cenario) });
    });
    await pagina.route('https://brasilapi.com.br/api/feriados/v1/**', rota => rota.fulfill({
        status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify([{ date: '2026-10-12', name: 'Nossa Senhora Aparecida', type: 'national' }])
    }));
    await pagina.goto('https://servicosead.praiagrande.sp.gov.br/folha/CadastroHoras.aspx');
    await pagina.addScriptTag({ content: script });
    assert.equal(await pagina.locator('#hel-app').count(), 1, 'interface iniciada');
    assert.equal(await pagina.locator('#helConsiderarFeriados').isChecked(), true, 'feriados permitidos por padrão');
    await pagina.selectOption('#helCarga', cenario.carga || '04:00');
    await pagina.selectOption('#helMesHoras', '10');
    await pagina.selectOption('#helAnoHoras', '2026');
    await pagina.fill('#txtServidor', '123456 Servidor Teste');
    await pagina.fill('#txtReg', '123456');
    await pagina.waitForFunction(() => document.querySelector('#helCalendarioTitulo')?.textContent.includes('consultado'));
    await pagina.fill('#helDias', cenario.dias || cenario.data.slice(0, 2));
    await pagina.click('#helAdicionarDias');
    if (await pagina.locator('#helLinhas tr').count()) {
        if ((cenario.carga && cenario.carga !== '04:00') || ['03', '12', '17', '18'].includes(cenario.data.slice(0, 2))) {
            assert.equal(await pagina.locator('#helLinhas tr .hel-saida-al').first().inputValue(), '', 'sem almoço presumido');
            assert.equal(await pagina.locator('#helLinhas tr .hel-retorno').first().inputValue(), '', 'sem retorno presumido');
        }
        for (const [classe, valor] of Object.entries({
            'hel-entrada': cenario.entrada, 'hel-saida-al': cenario.saidaAl,
            'hel-retorno': cenario.retorno, 'hel-saida': cenario.saida
        })) await pagina.locator('#helLinhas tr .' + classe).first().fill(valor);
    }
    return { contexto, pagina, posts, erros, registro: () => registro };
}

const cenarios = [
    { nome: 'dia útil com quatro horários conserva adaptação 04:00', data: '01/10/2026', entrada: '07:00', saidaAl: '11:00', retorno: '13:00', saida: '17:00', he50: '04:00', tecnico: ['09:00', '13:00', '13:00', '17:00'] },
    { nome: 'dia útil com duas marcações usa HE do servidor', data: '05/10/2026', entrada: '08:00', saidaAl: '', retorno: '', saida: '17:00', he50: '05:00', tecnico: ['08:00', '', '', '17:00'], marcadorVazio: true },
    { nome: 'sábado com quatro marcações e HE 100%', data: '03/10/2026', entrada: '07:00', saidaAl: '11:00', retorno: '12:00', saida: '16:00', he100: '08:00', tecnico: ['07:00', '11:00', '12:00', '16:00'] },
    { nome: 'sábado com duas marcações', data: '17/10/2026', entrada: '08:00', saidaAl: '', retorno: '', saida: '17:00', he50: '09:00', tecnico: ['08:00', '', '', '17:00'] },
    { nome: 'domingo com duas marcações e HE 100%', data: '18/10/2026', entrada: '08:00', saidaAl: '', retorno: '', saida: '13:00', he100: '05:00', tecnico: ['08:00', '', '', '13:00'] },
    { nome: 'feriado com quatro marcações', data: '12/10/2026', entrada: '07:00', saidaAl: '11:00', retorno: '12:00', saida: '16:00', he50: '08:00', tecnico: ['07:00', '11:00', '12:00', '16:00'] },
    { nome: 'feriado com duas marcações e carga 12:00', data: '12/10/2026', carga: '12:00', entrada: '08:00', saidaAl: '', retorno: '', saida: '17:00', he50: '09:00', tecnico: ['08:00', '', '', '17:00'] },
    { nome: 'carga 08:00 com intervalo mantém cálculo oficial', data: '01/10/2026', carga: '08:00', entrada: '07:06', saidaAl: '12:00', retorno: '13:00', saida: '18:57', he50: '02:51', tecnico: ['07:06', '12:00', '13:00', '18:57'] },
    { nome: 'carga 12:00 atravessa meia-noite sem almoço', data: '30/10/2026', carga: '12:00', entrada: '18:30', saidaAl: '', retorno: '', saida: '06:30', he50: '12:00', tecnico: ['18:30', '', '', '06:30'] }
];

test('cadastro e consulta: padrões de diferentes secretarias', async t => {
    const edge = process.env.HE_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const navegador = await chromium.launch(fs.existsSync(edge) ? { headless: true, executablePath: edge } : { headless: true });
    try {
        for (const cenario of cenarios) await t.test(cenario.nome, async () => {
            const ambiente = await abrirCenario(navegador, cenario);
            const { contexto, pagina, posts, erros } = ambiente;
            try {
                await pagina.click('#helCalcular');
                await pagina.waitForFunction(() => document.querySelector('#helLinhas tr')?.dataset.preview === '1');
                const total = (cenario.he50 || '00:00').split(':').map(Number)[0] * 60 + Number((cenario.he50 || '00:00').split(':')[1]) +
                    (cenario.he100 || '00:00').split(':').map(Number)[0] * 60 + Number((cenario.he100 || '00:00').split(':')[1]);
                const totalTexto = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
                assert.equal(await pagina.locator('#helLinhas tr .hel-total').textContent(), totalTexto);
                assert.equal(posts.length, 1, 'um POST de cálculo');
                const esperado = cenario.tecnico;
                ['txtEntrada', 'txtSaidaAl', 'txtRetornoAl', 'txtSaida'].forEach((chave, i) => assert.equal(posts[0].get(chave), esperado[i], chave));
                assert.equal(posts[0].get('DropDownList2'), cenario.carga || '04:00');
                if (!cenario.saidaAl) assert.match(await pagina.locator('#helLinhas tr .hel-status').textContent(), /confira regra da unidade/i);
                await pagina.click('#helEnviar');
                await pagina.waitForSelector('#helModalConfirmar:visible');
                assert.equal(await pagina.locator('#helModalCarga').textContent(), cenario.carga || '04:00');
                if (!cenario.saidaAl) assert.match(await pagina.locator('#helModalOutrosAvisos').textContent(), /Sem marcações de almoço/);
                for (const id of ['helConfirmExcecao', 'helConfirmFuturas', 'helConfirmCompat']) {
                    if (await pagina.locator('#' + id).isVisible()) await pagina.check('#' + id);
                }
                await pagina.click('#helModalConfirmar');
                await pagina.waitForFunction(() => document.querySelector('#helLinhas tr')?.dataset.conferenciaConsulta === 'conferido');
                assert.equal(posts.length, 3, 'cálculo, recálculo e inclusão');
                assert.equal(posts[2].get('btIncluir'), 'Incluir');
                assert.equal(posts[2].get('DropDownList2'), cenario.carga || '04:00');
                ['txtEntrada', 'txtSaidaAl', 'txtRetornoAl', 'txtSaida'].forEach((chave, i) => assert.equal(posts[2].get(chave), esperado[i], chave));
                assert.deepEqual(erros, [], 'sem erro JavaScript');
            } finally { await contexto.close(); }
        });

        for (const cenario of [
            { nome: 'almoço incompleto', data: '05/10/2026', entrada: '08:00', saidaAl: '12:00', retorno: '', saida: '17:00' },
            { nome: 'sequência inconsistente', data: '05/10/2026', carga: '12:00', entrada: '08:00', saidaAl: '12:00', retorno: '11:00', saida: '17:00' }
        ]) await t.test(cenario.nome + ' bloqueia cálculo', async () => {
            const { contexto, pagina, posts, erros } = await abrirCenario(navegador, cenario);
            try {
                await pagina.click('#helCalcular');
                assert.equal(posts.length, 0, 'nenhum POST de cálculo inválido');
                assert.notEqual(await pagina.locator('#helLinhas tr').getAttribute('data-preview'), '1');
                assert.deepEqual(erros, []);
            } finally { await contexto.close(); }
        });

        await t.test('data duplicada no lote não cria outra linha', async () => {
            const { contexto, pagina, erros } = await abrirCenario(navegador, {
                data: '05/10/2026', dias: '05,05', entrada: '08:00', saidaAl: '', retorno: '', saida: '17:00'
            });
            try {
                assert.equal(await pagina.locator('#helLinhas tr').count(), 1);
                assert.deepEqual(erros, []);
            } finally { await contexto.close(); }
        });

        await t.test('data já existente na consulta não é reenviada', async () => {
            const { contexto, pagina, posts, erros } = await abrirCenario(navegador, {
                data: '05/10/2026', entrada: '08:00', saidaAl: '', retorno: '', saida: '17:00',
                he50: '05:00', preexistente: true
            });
            try {
                await pagina.click('#helCalcular');
                assert.equal(posts.length, 0, 'nenhum POST de cálculo ou inclusão');
                assert.notEqual(await pagina.locator('#helLinhas tr').getAttribute('data-preview'), '1');
                assert.deepEqual(erros, []);
            } finally { await contexto.close(); }
        });

        await t.test('atalho da primeira quinzena inclui fins de semana e feriado', async () => {
            const { contexto, pagina, erros } = await abrirCenario(navegador, {
                data: '01/10/2026', entrada: '08:00', saidaAl: '', retorno: '', saida: '17:00'
            });
            try {
                await pagina.click('#helPrimeiraQuinzena');
                await pagina.waitForFunction(() => document.querySelectorAll('#helLinhas tr').length === 15);
                const datas = await pagina.locator('#helLinhas .hel-data').evaluateAll(entradas => entradas.map(entrada => entrada.value));
                assert.ok(datas.includes('03/10/2026'), 'sábado');
                assert.ok(datas.includes('04/10/2026'), 'domingo');
                assert.ok(datas.includes('12/10/2026'), 'feriado');
                assert.deepEqual(erros, []);
            } finally { await contexto.close(); }
        });

        await t.test('desmarcar feriados preserva bloqueio explícito', async () => {
            const { contexto, pagina, posts, erros } = await abrirCenario(navegador, {
                data: '12/10/2026', entrada: '08:00', saidaAl: '', retorno: '', saida: '17:00', he50: '09:00'
            });
            try {
                await pagina.uncheck('#helConsiderarFeriados');
                await pagina.click('#helCalcular');
                assert.equal(posts.length, 0, 'nenhum POST para feriado bloqueado por escolha');
                assert.deepEqual(erros, []);
            } finally { await contexto.close(); }
        });

        await t.test('regra tradicional 04:00 ainda rejeita HE divergente', async () => {
            const { contexto, pagina, posts, erros } = await abrirCenario(navegador, {
                data: '01/10/2026', entrada: '07:00', saidaAl: '11:00', retorno: '13:00', saida: '17:00', he50: '05:00'
            });
            try {
                await pagina.click('#helCalcular');
                await pagina.waitForFunction(() => document.querySelector('#helLinhas tr .hel-status')?.textContent.includes('esperado 04:00'));
                assert.equal(posts.length, 1, 'apenas cálculo, sem inclusão');
                assert.notEqual(await pagina.locator('#helLinhas tr').getAttribute('data-preview'), '1');
                assert.deepEqual(erros, []);
            } finally { await contexto.close(); }
        });
    } finally { await navegador.close(); }
});

test('tela de consulta distingue duas marcações válidas de registros inválidos', async t => {
    const edge = process.env.HE_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const navegador = await chromium.launch(fs.existsSync(edge) ? { headless: true, executablePath: edge } : { headless: true });
    try {
        const parametros = new URLSearchParams({ TextBox1: '123456', DropDownList1: 'Novembro', anoPeriodo: '2026' });
        for (const caso of [
            { nome: 'sábado sem almoço', data: '03/10/2026', entrada: '07:00', saidaAl: '', retorno: '', saida: '19:00', valido: true },
            { nome: 'horário de almoço parcial', data: '03/10/2026', entrada: '07:00', saidaAl: '12:00', retorno: '', saida: '19:00', valido: false },
            { nome: 'linha duplicada', data: '03/10/2026', entrada: '07:00', saidaAl: '', retorno: '', saida: '19:00', valido: false, duplicado: true }
        ]) await t.test(caso.nome, async () => {
            const contexto = await navegador.newContext({ locale: 'pt-BR' });
            const pagina = await contexto.newPage(), erros = [];
            pagina.on('pageerror', erro => erros.push(erro.message));
            const registro = new URLSearchParams({ txtData: caso.data, txtEntrada: caso.entrada,
                txtSaidaAl: caso.saidaAl, txtRetornoAl: caso.retorno, txtSaida: caso.saida });
            let html = consulta(parametros, registro, { he50: '12:00', marcadorVazio: true });
            if (caso.duplicado) {
                const linha = html.match(/<tr><td>123456<\/td>.*?<\/tr>/s)[0];
                html = html.replace('</table>', linha + '</table>');
            }
            await pagina.route('**/folha/ConsultaRegistro.aspx', rota => rota.fulfill({ status: 200, contentType: 'text/html', body: html }));
            try {
                await pagina.goto('https://servicosead.praiagrande.sp.gov.br/folha/ConsultaRegistro.aspx');
                await pagina.addScriptTag({ content: script });
                assert.equal(await pagina.locator('#helq-app').count(), 1);
                if (caso.valido) {
                    assert.equal(await pagina.locator('#helqContagem').textContent(), '1', (await pagina.locator('#helqStatus').textContent()) + ' ' + JSON.stringify(await pagina.locator('#GridView1 tr').last().locator('td').allTextContents()));
                    assert.equal(await pagina.locator('#helqTotal50').textContent(), '12:00');
                    assert.equal(await pagina.locator('#helqCopiarResumo').isDisabled(), false);
                } else {
                    assert.equal(await pagina.locator('#helqContagem').textContent(), '—');
                    assert.equal(await pagina.locator('#helqCopiarResumo').isDisabled(), true);
                }
                assert.deepEqual(erros, []);
            } finally { await contexto.close(); }
        });
    } finally { await navegador.close(); }
});
