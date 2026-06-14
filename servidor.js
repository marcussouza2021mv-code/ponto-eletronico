// ================================================================
// SISTEMA DE PONTO ELETRÔNICO — BACKEND COMPLETO
// Node.js + Express + PostgreSQL (Supabase) + Face++ (grátis)
// ================================================================

// Forçar IPv4 (necessário no Render free tier)
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const FormData = require('form-data');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

pool.connect()
  .then(() => console.log('✅ Banco de dados conectado'))
  .catch(err => console.error('❌ Erro no banco:', err.message));

const JWT_SECRET = process.env.JWT_SECRET || 'mude-esta-chave-em-producao-123';
const FACEPP_KEY = process.env.FACEPP_API_KEY || '';
const FACEPP_SECRET = process.env.FACEPP_API_SECRET || '';
const PORT = process.env.PORT || 3000;

function autenticar(perfisPermitidos = []) {
  return (req, res, next) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ erro: 'Token não informado' });
    try {
      const dados = jwt.verify(token, JWT_SECRET);
      req.usuario = dados;
      if (perfisPermitidos.length > 0 && !perfisPermitidos.includes(dados.perfil)) {
        return res.status(403).json({ erro: 'Sem permissão para esta ação' });
      }
      next();
    } catch {
      res.status(401).json({ erro: 'Token inválido ou expirado' });
    }
  };
}

function gerarHash(texto) {
  return crypto.createHash('sha256').update(texto).digest('hex');
}

function arredondar(valor) {
  return Math.round(valor * 100) / 100;
}

async function detectarRostoFacePP(imagemBase64) {
  try {
    const form = new FormData();
    form.append('api_key', FACEPP_KEY);
    form.append('api_secret', FACEPP_SECRET);
    form.append('image_base64', imagemBase64);
    form.append('return_attributes', 'none');
    const resp = await axios.post('https://api-us.faceplusplus.com/facepp/v3/detect', form, { headers: form.getHeaders(), timeout: 10000 });
    const faces = resp.data.faces || [];
    if (faces.length === 0) return { sucesso: false, erro: 'Nenhum rosto detectado na imagem' };
    if (faces.length > 1) return { sucesso: false, erro: 'Mais de um rosto detectado. Fique sozinho na câmera.' };
    return { sucesso: true, faceToken: faces[0].face_token };
  } catch (err) {
    return { sucesso: false, erro: 'Erro ao processar imagem facial' };
  }
}

async function compararRostosFacePP(faceToken1, faceToken2) {
  try {
    const form = new FormData();
    form.append('api_key', FACEPP_KEY);
    form.append('api_secret', FACEPP_SECRET);
    form.append('face_token1', faceToken1);
    form.append('face_token2', faceToken2);
    const resp = await axios.post('https://api-us.faceplusplus.com/facepp/v3/compare', form, { headers: form.getHeaders(), timeout: 10000 });
    const confianca = resp.data.confidence || 0;
    return { sucesso: true, confianca, autenticado: confianca >= 80 };
  } catch (err) {
    return { sucesso: false, confianca: 0, autenticado: false };
  }
}

app.post('/auth/login', async (req, res) => {
  const { matricula, senha } = req.body;
  if (!matricula || !senha) return res.status(400).json({ erro: 'Matrícula e senha são obrigatórios' });
  try {
    const { rows } = await pool.query('SELECT * FROM colaboradores WHERE matricula = $1 AND ativo = true', [matricula]);
    if (rows.length === 0) return res.status(401).json({ erro: 'Matrícula não encontrada' });
    const colaborador = rows[0];
    if (!colaborador.senha_hash) return res.status(401).json({ erro: 'Este colaborador não tem acesso ao sistema' });
    const senhaOk = await bcrypt.compare(senha, colaborador.senha_hash);
    if (!senhaOk) return res.status(401).json({ erro: 'Senha incorreta' });
    const token = jwt.sign({ id: colaborador.id, matricula: colaborador.matricula, nome: colaborador.nome, perfil: colaborador.perfil, empresa_id: colaborador.empresa_id }, JWT_SECRET, { expiresIn: '12h' });
    res.json({ token, colaborador: { id: colaborador.id, nome: colaborador.nome, cargo: colaborador.cargo, perfil: colaborador.perfil } });
  } catch (err) {
    res.status(500).json({ erro: 'Erro interno do servidor' });
  }
});

app.post('/ponto/registrar', async (req, res) => {
  const { matricula, imagemBase64, latitude, longitude, dispositivo } = req.body;
  if (!matricula || !imagemBase64) return res.status(400).json({ erro: 'Matrícula e imagem são obrigatórios' });
  try {
    const { rows } = await pool.query('SELECT * FROM colaboradores WHERE matricula = $1 AND ativo = true', [matricula]);
    if (rows.length === 0) return res.status(404).json({ sucesso: false, mensagem: 'Matrícula não encontrada' });
    const colaborador = rows[0];
    if (!colaborador.face_token) {
      const deteccao = await detectarRostoFacePP(imagemBase64);
      if (!deteccao.sucesso) return res.status(400).json({ sucesso: false, mensagem: deteccao.erro });
      await pool.query('UPDATE colaboradores SET face_token = $1 WHERE id = $2', [deteccao.faceToken, colaborador.id]);
      const tipo = 'ENTRADA';
      const dataHora = new Date();
      const hashRegistro = gerarHash(`${colaborador.id}|${tipo}|${dataHora.toISOString()}|${latitude}|${longitude}`);
      const hashImagem = gerarHash(imagemBase64);
      await pool.query('INSERT INTO registros_ponto (colaborador_id, tipo, data_hora, latitude, longitude, confianca_facial, hash_registro, hash_imagem, dispositivo, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [colaborador.id, tipo, dataHora, latitude, longitude, 100, hashRegistro, hashImagem, dispositivo, req.ip]);
      return res.json({ sucesso: true, mensagem: `Rosto cadastrado e ${tipo} registrada às ${dataHora.toLocaleTimeString('pt-BR')}`, primeiroAcesso: true });
    }
    const deteccao = await detectarRostoFacePP(imagemBase64);
    if (!deteccao.sucesso) return res.status(400).json({ sucesso: false, mensagem: deteccao.erro });
    const comparacao = await compararRostosFacePP(deteccao.faceToken, colaborador.face_token);
    if (!comparacao.autenticado) return res.json({ sucesso: false, mensagem: `Rosto não reconhecido (confiança: ${comparacao.confianca.toFixed(0)}%). Tente novamente com boa iluminação.` });
    const { rows: ultimosRegistros } = await pool.query(`SELECT tipo FROM registros_ponto WHERE colaborador_id = $1 AND DATE(data_hora AT TIME ZONE 'America/Sao_Paulo') = CURRENT_DATE ORDER BY data_hora DESC LIMIT 1`, [colaborador.id]);
    const sequencia = ['ENTRADA', 'SAIDA_ALMOCO', 'RETORNO_ALMOCO', 'SAIDA'];
    let tipo = 'ENTRADA';
    if (ultimosRegistros.length > 0) {
      const idx = sequencia.indexOf(ultimosRegistros[0].tipo);
      if (idx < sequencia.length - 1) tipo = sequencia[idx + 1];
      else return res.json({ sucesso: false, mensagem: 'Todos os registros de hoje já foram feitos.' });
    }
    const dataHora = new Date();
    const hashRegistro = gerarHash(`${colaborador.id}|${tipo}|${dataHora.toISOString()}|${latitude}|${longitude}`);
    const hashImagem = gerarHash(imagemBase64);
    const { rows: novoRegistro } = await pool.query(`INSERT INTO registros_ponto (colaborador_id, tipo, data_hora, latitude, longitude, confianca_facial, hash_registro, hash_imagem, dispositivo, ip) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [colaborador.id, tipo, dataHora, latitude || null, longitude || null, comparacao.confianca, hashRegistro, hashImagem, dispositivo || 'mobile', req.ip]);
    const labels = { ENTRADA: 'Entrada', SAIDA_ALMOCO: 'Saída Almoço', RETORNO_ALMOCO: 'Retorno Almoço', SAIDA: 'Saída' };
    res.json({ sucesso: true, mensagem: `${labels[tipo]} registrada às ${dataHora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`, registro: novoRegistro[0], colaborador: { nome: colaborador.nome, cargo: colaborador.cargo } });
  } catch (err) {
    res.status(500).json({ sucesso: false, mensagem: 'Erro no servidor. Tente novamente.' });
  }
});

app.get('/ponto/hoje/:matricula', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT rp.*, c.nome, c.cargo FROM registros_ponto rp JOIN colaboradores c ON rp.colaborador_id = c.id WHERE c.matricula = $1 AND DATE(rp.data_hora AT TIME ZONE 'America/Sao_Paulo') = CURRENT_DATE ORDER BY rp.data_hora ASC`, [req.params.matricula]);
    res.json({ registros: rows });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar registros' });
  }
});

app.get('/ponto/mes/:matricula', autenticar(), async (req, res) => {
  const { mes, ano } = req.query;
  try {
    const { rows } = await pool.query(`SELECT rp.* FROM registros_ponto rp JOIN colaboradores c ON rp.colaborador_id = c.id WHERE c.matricula = $1 AND EXTRACT(MONTH FROM rp.data_hora AT TIME ZONE 'America/Sao_Paulo') = $2 AND EXTRACT(YEAR FROM rp.data_hora AT TIME ZONE 'America/Sao_Paulo') = $3 ORDER BY rp.data_hora ASC`,
      [req.params.matricula, mes || new Date().getMonth() + 1, ano || new Date().getFullYear()]);
    res.json({ registros: rows });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar registros do mês' });
  }
});

app.get('/colaboradores', autenticar(['RH', 'ADMIN', 'GESTOR']), async (req, res) => {
  const { busca, ativo = 'true' } = req.query;
  try {
    let query = `SELECT c.id, c.matricula, c.nome, c.cpf, c.cargo, c.email, c.telefone, c.data_admissao, c.salario, c.perfil, c.ativo, c.foto_url, c.face_token, d.nome AS departamento, j.descricao AS jornada FROM colaboradores c LEFT JOIN departamentos d ON c.departamento_id = d.id LEFT JOIN jornadas j ON c.jornada_id = j.id WHERE c.empresa_id = $1 AND c.ativo = $2`;
    const params = [req.usuario.empresa_id, ativo === 'true'];
    if (busca) { query += ` AND (c.nome ILIKE $3 OR c.matricula ILIKE $3 OR c.cpf ILIKE $3)`; params.push(`%${busca}%`); }
    query += ' ORDER BY c.nome ASC';
    const { rows } = await pool.query(query, params);
    res.json({ colaboradores: rows, total: rows.length });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao listar colaboradores' });
  }
});

app.post('/colaboradores', autenticar(['RH', 'ADMIN']), async (req, res) => {
  const { matricula, nome, cpf, email, telefone, cargo, salario, data_admissao, departamento_id, jornada_id, perfil, senha } = req.body;
  if (!matricula || !nome || !cpf || !data_admissao) return res.status(400).json({ erro: 'Campos obrigatórios: matricula, nome, cpf, data_admissao' });
  try {
    const senhaHash = senha ? await bcrypt.hash(senha, 10) : null;
    const { rows } = await pool.query(`INSERT INTO colaboradores (empresa_id, matricula, nome, cpf, email, telefone, cargo, salario, data_admissao, departamento_id, jornada_id, perfil, senha_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, nome, matricula`,
      [req.usuario.empresa_id, matricula, nome, cpf, email, telefone, cargo, salario || 0, data_admissao, departamento_id, jornada_id, perfil || 'COLABORADOR', senhaHash]);
    res.status(201).json({ sucesso: true, colaborador: rows[0] });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ erro: 'Matrícula ou CPF já cadastrado' });
    res.status(500).json({ erro: 'Erro ao cadastrar colaborador' });
  }
});

app.get('/colaboradores/:matricula', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT c.id, c.matricula, c.nome, c.cargo, c.foto_url, d.nome AS departamento, j.descricao AS jornada, j.hora_entrada, j.hora_saida FROM colaboradores c LEFT JOIN departamentos d ON c.departamento_id = d.id LEFT JOIN jornadas j ON c.jornada_id = j.id WHERE c.matricula = $1 AND c.ativo = true`, [req.params.matricula]);
    if (rows.length === 0) return res.status(404).json({ erro: 'Colaborador não encontrado' });
    res.json(rows[0]);
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar colaborador' });
  }
});

app.get('/rh/dashboard', autenticar(['RH', 'ADMIN', 'GESTOR']), async (req, res) => {
  try {
    const { rows: situacao } = await pool.query(`SELECT situacao_atual, COUNT(*) AS total FROM vw_ponto_hoje GROUP BY situacao_atual`);
    const { rows: presentes } = await pool.query(`SELECT * FROM vw_ponto_hoje WHERE situacao_atual != 'AUSENTE' ORDER BY nome`);
    const { rows: ausentes } = await pool.query(`SELECT * FROM vw_ponto_hoje WHERE situacao_atual = 'AUSENTE' ORDER BY nome`);
    const { rows: advertenciasPendentes } = await pool.query(`SELECT a.*, c.nome AS colaborador_nome FROM advertencias a JOIN colaboradores c ON a.colaborador_id = c.id WHERE a.status IN ('PENDENTE_RH', 'APROVADA') ORDER BY a.created_at DESC LIMIT 10`);
    const { rows: rescisoesPendentes } = await pool.query(`SELECT r.*, c.nome AS colaborador_nome FROM rescisoes r JOIN colaboradores c ON r.colaborador_id = c.id WHERE r.status NOT IN ('APROVADO','CANCELADO') ORDER BY r.created_at DESC LIMIT 10`);
    res.json({
      resumo: { trabalhando: situacao.find(s => s.situacao_atual === 'TRABALHANDO')?.total || 0, almoco: situacao.find(s => s.situacao_atual === 'ALMOCO')?.total || 0, saiu: situacao.find(s => s.situacao_atual === 'SAIU')?.total || 0, ausentes: situacao.find(s => s.situacao_atual === 'AUSENTE')?.total || 0 },
      presentes, ausentes, advertenciasPendentes, rescisoesPendentes
    });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao carregar dashboard' });
  }
});

app.post('/advertencias', autenticar(['RH', 'ADMIN', 'GESTOR']), async (req, res) => {
  const { colaborador_id, tipo, motivo, descricao_detalhada, data_ocorrencia, dias_suspensao } = req.body;
  if (!colaborador_id || !tipo || !motivo || !data_ocorrencia) return res.status(400).json({ erro: 'Campos obrigatórios: colaborador_id, tipo, motivo, data_ocorrencia' });
  try {
    const { rows } = await pool.query(`INSERT INTO advertencias (colaborador_id, gestor_id, tipo, motivo, descricao_detalhada, data_ocorrencia, dias_suspensao, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'PENDENTE_RH') RETURNING *`,
      [colaborador_id, req.usuario.id, tipo, motivo, descricao_detalhada, data_ocorrencia, dias_suspensao || 0]);
    res.status(201).json({ sucesso: true, advertencia: rows[0] });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao emitir advertência' });
  }
});

app.put('/advertencias/:id/aprovar', autenticar(['RH', 'ADMIN']), async (req, res) => {
  try {
    await pool.query(`UPDATE advertencias SET status = 'APROVADA', rh_aprovador_id = $1, data_emissao = NOW(), updated_at = NOW() WHERE id = $2`, [req.usuario.id, req.params.id]);
    res.json({ sucesso: true, mensagem: 'Advertência aprovada.' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao aprovar advertência' });
  }
});

app.put('/advertencias/:id/assinar', async (req, res) => {
  const { matricula, aceita, justificativa_recusa } = req.body;
  try {
    const novoStatus = aceita ? 'ASSINADA_COLABORADOR' : 'RECUSADA';
    const assinaturaHash = aceita ? gerarHash(`${req.params.id}|${matricula}|${new Date().toISOString()}`) : null;
    await pool.query(`UPDATE advertencias SET status = $1, data_assinatura = NOW(), assinatura_hash = $2, recusa_justificativa = $3, updated_at = NOW() WHERE id = $4`,
      [novoStatus, assinaturaHash, justificativa_recusa || null, req.params.id]);
    res.json({ sucesso: true, mensagem: aceita ? 'Advertência assinada.' : 'Recusa registrada com justificativa.' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao processar assinatura' });
  }
});

app.get('/advertencias/colaborador/:id', autenticar(), async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT a.*, g.nome AS gestor_nome FROM advertencias a JOIN colaboradores g ON a.gestor_id = g.id WHERE a.colaborador_id = $1 ORDER BY a.created_at DESC`, [req.params.id]);
    res.json({ advertencias: rows });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar advertências' });
  }
});

app.post('/rescisao/calcular', autenticar(['RH', 'ADMIN', 'GESTOR']), async (req, res) => {
  const { colaborador_id, tipo, data_desligamento } = req.body;
  if (!colaborador_id || !tipo || !data_desligamento) return res.status(400).json({ erro: 'colaborador_id, tipo e data_desligamento são obrigatórios' });
  try {
    const { rows } = await pool.query('SELECT * FROM colaboradores WHERE id = $1', [colaborador_id]);
    if (rows.length === 0) return res.status(404).json({ erro: 'Colaborador não encontrado' });
    const colab = rows[0];
    const desligamento = new Date(data_desligamento);
    const admissao = new Date(colab.data_admissao);
    const salario = parseFloat(colab.salario);
    const mesesTotal = (desligamento.getFullYear() - admissao.getFullYear()) * 12 + (desligamento.getMonth() - admissao.getMonth());
    const diasNoMes = new Date(desligamento.getFullYear(), desligamento.getMonth() + 1, 0).getDate();
    const diasTrabalhados = desligamento.getDate();
    const saldoSalario = arredondar((salario / diasNoMes) * diasTrabalhados);
    let avisoPrevio = 0;
    if (tipo === 'SEM_JUSTA_CAUSA') { const anosCompletos = Math.floor(mesesTotal / 12); avisoPrevio = arredondar(salario + (salario / 30 * Math.min(anosCompletos * 3, 60))); }
    else if (tipo === 'ACORDO_MUTUO') avisoPrevio = arredondar(salario * 0.5);
    else if (tipo === 'PEDIDO_DEMISSAO') avisoPrevio = arredondar(-salario);
    const mesesParaDecimoTerceiro = mesesTotal % 12 || (diasTrabalhados >= 15 ? 1 : 0);
    const decimoTerceiro = arredondar((salario / 12) * mesesParaDecimoTerceiro);
    const feriasProporcionais = arredondar((salario / 12) * (mesesTotal % 12));
    const feriasVencidas = 0;
    const umTercoFerias = arredondar((feriasProporcionais + feriasVencidas) / 3);
    const saldoFgts = arredondar(salario * 0.08 * mesesTotal);
    let multaFgts = 0;
    if (tipo === 'SEM_JUSTA_CAUSA') multaFgts = arredondar(saldoFgts * 0.40);
    else if (tipo === 'ACORDO_MUTUO') multaFgts = arredondar(saldoFgts * 0.20);
    const totalBruto = arredondar(saldoSalario + avisoPrevio + decimoTerceiro + feriasProporcionais + feriasVencidas + umTercoFerias + multaFgts);
    const baseINSS = Math.min(saldoSalario + Math.max(avisoPrevio, 0) + decimoTerceiro, 7786.02);
    let inss = 0, base = baseINSS, anterior = 0;
    for (const [ate, ali] of [[1412, 0.075], [2666.68, 0.09], [4000.03, 0.12], [7786.02, 0.14]]) {
      if (base <= 0) break;
      const faixa = Math.min(base, ate - anterior);
      inss += faixa * ali; base -= faixa; anterior = ate;
    }
    inss = arredondar(inss);
    const baseIRRF = Math.max(0, baseINSS - inss);
    let irrf = 0;
    if (baseIRRF > 2259.20) {
      if (baseIRRF <= 2826.65) irrf = baseIRRF * 0.075 - 169.44;
      else if (baseIRRF <= 3751.05) irrf = baseIRRF * 0.15 - 381.44;
      else if (baseIRRF <= 4664.68) irrf = baseIRRF * 0.225 - 662.77;
      else irrf = baseIRRF * 0.275 - 896.00;
    }
    irrf = arredondar(Math.max(0, irrf));
    const totalDesconto = arredondar(inss + irrf);
    const totalLiquido = arredondar(totalBruto - totalDesconto);
    const dataPagamento = new Date(desligamento);
    dataPagamento.setDate(dataPagamento.getDate() + 10);
    res.json({ colaborador: { nome: colab.nome, matricula: colab.matricula, cargo: colab.cargo, salario, data_admissao: colab.data_admissao }, tipo, data_desligamento, meses_trabalhados: mesesTotal, verbas: { saldoSalario, avisoPrevio, decimoTerceiro, feriasProporcionais, feriasVencidas, umTercoFerias, multaFgts }, descontos: { inss, irrf }, totais: { totalBruto, totalDesconto, totalLiquido }, saldoFgts, data_pagamento: dataPagamento.toISOString().split('T')[0] });
  } catch (err) {
    res.status(500).json({ erro: 'Erro no cálculo de rescisão' });
  }
});

app.post('/rescisao/iniciar', autenticar(['RH', 'ADMIN', 'GESTOR']), async (req, res) => {
  const { colaborador_id, tipo, data_desligamento, motivo } = req.body;
  try {
    const calcResp = await axios.post(`http://localhost:${PORT}/rescisao/calcular`, { colaborador_id, tipo, data_desligamento }, { headers: { Authorization: req.headers.authorization } });
    const calc = calcResp.data;
    const { rows } = await pool.query(`INSERT INTO rescisoes (colaborador_id, iniciado_por, tipo, data_desligamento, motivo, status, saldo_salario, aviso_previo, decimo_terceiro, ferias_proporcionais, ferias_vencidas, um_terco_ferias, multa_fgts, inss_desconto, irrf_desconto, total_bruto, total_desconto, total_liquido, saldo_fgts, data_pagamento) VALUES ($1,$2,$3,$4,$5,'AGUARDANDO_RH',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
      [colaborador_id, req.usuario.id, tipo, data_desligamento, motivo, calc.verbas.saldoSalario, calc.verbas.avisoPrevio, calc.verbas.decimoTerceiro, calc.verbas.feriasProporcionais, calc.verbas.feriasVencidas, calc.verbas.umTercoFerias, calc.verbas.multaFgts, calc.descontos.inss, calc.descontos.irrf, calc.totais.totalBruto, calc.totais.totalDesconto, calc.totais.totalLiquido, calc.saldoFgts, calc.data_pagamento]);
    res.status(201).json({ sucesso: true, rescisao_id: rows[0].id, calculo: calc });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao iniciar rescisão' });
  }
});

app.put('/rescisao/:id/aprovar', autenticar(['RH', 'ADMIN']), async (req, res) => {
  try {
    await pool.query(`UPDATE rescisoes SET status = 'APROVADO', aprovado_rh = $1, updated_at = NOW() WHERE id = $2`, [req.usuario.id, req.params.id]);
    res.json({ sucesso: true, mensagem: 'Rescisão aprovada. TRCT pode ser gerado.' });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao aprovar rescisão' });
  }
});

app.get('/', (req, res) => {
  res.json({ sistema: 'Ponto Eletrônico API', versao: '1.0.0', status: 'online', hora: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) });
});

app.listen(PORT, () => {
  console.log(`\n🚀 Servidor rodando na porta ${PORT}`);
  console.log(`📌 Acesse: http://localhost:${PORT}`);
});

module.exports = app;
