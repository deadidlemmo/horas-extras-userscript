# Horas Extras — lançamento e consulta

![Tampermonkey](https://img.shields.io/badge/Userscript-Tampermonkey-161b22?style=for-the-badge&logo=tampermonkey&logoColor=9cdd64) ![Versão](https://img.shields.io/badge/versão-4.6.0--beta.21-6e9f43?style=for-the-badge)

Userscript criado por **Nilson Cruz** para tornar mais simples o cadastro e a conferência de horas extras no navegador. É um complemento independente: os registros oficiais continuam no sistema original.

## O que faz

- Prepara vários dias de horas extras em um único lote e mostra o cálculo antes do envio.
- Organiza a página inicial com acesso ao Cadastro, à Consulta e à alteração de senha.
- Permite escolher a carga horária do formulário oficial: 04:00, 06:00, 08:00 ou 12:00.
- Na carga 04:00, mantém o cálculo e a adaptação técnica de horários já usados, sem impor teto de 4 horas extras.
- Nas outras cargas, aceita turnos que passam da meia-noite e intervalo em branco; a HE do cadastro vem do cálculo devolvido pelo sistema oficial.
- Consulta dias já registrados e sinaliza possíveis duplicidades ou divergências.
- Organiza relatórios e exclusões, com confirmação e conferência do resultado.
- Consulta feriados nacionais pela BrasilAPI e apresenta avisos para datas que exigem revisão.
- Guarda rascunhos e operações pendentes no navegador para ajudar a recuperar respostas incertas.

## Instalação

1. Instale a extensão Tampermonkey no navegador autorizado para uso do sistema.
2. Abra [o arquivo do userscript](Horas_Extras_v4_6_BETA.user.js), copie seu conteúdo e crie um novo script no painel do Tampermonkey.
3. Salve e acesse a página de cadastro ou consulta de horas extras com sua própria conta.

O script declara as páginas em que atua por `@match`. Ele não fornece acesso ao sistema nem substitui a autenticação.

## Situação e cuidados

Esta é uma **versão beta**. Os testes locais reproduziram os exemplos enviados pelo usuário: carga 12:00 com 18:30–06:30 retornando 12:00 de HE; carga 12:00 com 17:00–20:00 retornando 03:00; e carga 08:00 com 07:06–12:00 / 13:00–18:57 retornando 02:51. O contrato de cálculo, inclusão e consulta foi testado com respostas WebForms controladas. Ainda é necessária homologação na intranet: o simulador não comprova todas as regras do servidor, especialmente para cargas e horários não exemplificados. Confira a HE devolvida pelo sistema, os feriados e a consulta antes de considerar uma operação concluída. Em caso de resposta incerta, não repita o envio automaticamente.

O código publicado omite o número funcional e o telefone pessoal presentes no material de distribuição local. Para relatar um problema, use [GitHub Issues](https://github.com/deadidlemmo/horas-extras-userscript/issues), sem incluir dados de servidores, senhas ou capturas não anonimizadas.

## Arquivos

| Arquivo | Conteúdo |
| --- | --- |
| [`Horas_Extras_v4_6_BETA.user.js`](Horas_Extras_v4_6_BETA.user.js) | Userscript 4.6.0-beta.21 |

## Autoria

Projeto independente de **Nilson Cruz**. A autoria se refere ao userscript, e não ao sistema oficial de banco de horas. Não há licença de reutilização definida neste repositório.
