const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');

const app = express();
app.use(cors());
app.use(express.json({ limit: '20mb' }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
pool.connect().then(() => console.log('✅ Banco de dados conectado')).catch(err => console.error('❌ Erro no banco:', err.message));

const JWT_SECRET = process.env.JWT_SECRET || 'chave-secreta-123';
const FACEPP_KEY = process.env.FACEPP_API_KEY || '';
const FACEPP_SECRET = process.env.FACEPP_API_SECRET || '';
const PORT = process.env.PORT || 3000;

function autenticar(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ erro: 'Token não informado' });
  try { req.usuario = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ erro: 'Token inválido' }); }
}

// ── FACESET (salvo no banco) ──────────────────────────────
async function getFacesetToken() {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS configuracoes (chave VARCHAR(100) PRIMARY KEY, valor TEXT)`);
    const r = await pool.query(`SELECT valor FROM configuracoes WHERE chave = 'faceset_token'`);
    if (r.rows.length > 0) return r.rows[0].valor;
    // Criar novo faceset
    const fd = new FormData();
    fd.append('api_key', FACEPP_KEY);
    fd.append('api_secret', FACEPP_SECRET);
    fd.append('display_name', 'medplus_colaboradores');
    const resp = await axios.post('https://api-us.faceplusplus.com/facepp/v3/faceset/create', fd, { headers: fd.getHeaders() });
    const token = resp.data.faceset_token;
    await pool.query(`INSERT INTO configuracoes (chave, valor) VALUES ('faceset_token', $1)`, [token]);
    console.log('✅ FaceSet criado:', token);
    return token;
  } catch (e) {
    console.error('❌ Erro FaceSet:', e.message);
    return null;
  }
}

// ── FACE++ FUNÇÕES ────────────────────────────────────────
async function detectarRosto(base64) {
  const fd = new FormData();
  fd.append('api_key', FACEPP_KEY);
  fd.append('api_secret', FACEPP_SECRET);
  fd.append('image_base64', base64);
  const r = await axios.post('https://api-us.faceplusplus.com/facepp/v3/detect', fd, { headers: fd.getHeaders() });
  return r.data.faces?.[0]?.face_token || null;
}

async function adicionarAoFaceset(faceToken, facesetToken) {
  const fd = new FormData();
  fd.append('api_key', FACEPP_KEY);
  fd.append('api_secret', FACEPP_SECRET);
  fd.append('faceset_token', facesetToken);
  fd.append('face_tokens', faceToken);
  await axios.post('https://api-us.faceplusplus.com/facepp/v3/faceset/addface', fd, { headers: fd.getHeaders() });
}

async function buscarNoFaceset(faceToken, facesetToken) {
  const fd = new FormData();
  fd.append('api_key', FACEPP_KEY);
  fd.append('api_secret', FACEPP_SECRET);
  fd.append('face_token', faceToken);
  fd.append('faceset_token', facesetToken);
  const r = await axios.post('https://api-us.faceplusplus.com/facepp/v3/search', fd, { headers: fd.getHeaders() });
  const resultado = r.data.results?.[0];
  if (resultado && resultado.confidence > 75) return resultado.face_token;
  return null;
}

// ── STATUS ────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ sistema: 'Ponto Eletrônico API', versao: '2.0.0', status: 'online', hora: new Date().toLocaleString('pt-BR') }));

// ── LOGIN ─────────────────────────────────────────────────
app.post('/auth/login', async (req, res) => {
  try {
    const { matricula, senha } = req.body;
    const r = await pool.query('SELECT * FROM colaboradores WHERE matricula = $1 AND ativo = true', [matricula]);
    if (r.rows.length === 0) return res.json({ erro: 'Matrícula não encontrada' });
    const colab = r.rows[0];
    const ok = await bcrypt.compare(senha, colab.senha_hash || '');
    if (!ok) return res.json({ erro: 'Senha incorreta' });
    const token = jwt.sign({ id: colab.id, matricula: colab.matricula, perfil: colab.perfil }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, colaborador: { id: colab.id, nome: colab.nome, matricula: colab.matricula, cargo: colab.cargo, perfil: colab.perfil } });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── CADASTRAR ROSTO ───────────────────────────────────────
app.post('/facial/cadastrar', async (req, res) => {
  try {
    const { cpf, foto_base64 } = req.body;
    if (!cpf || !foto_base64) return res.json({ erro: 'CPF e foto são obrigatórios' });
    const r = await pool.query('SELECT * FROM colaboradores WHERE cpf = $1 AND ativo = true', [cpf]);
    if (r.rows.length === 0) return res.json({ erro: 'CPF não encontrado. Fale com o RH.' });
    const colab = r.rows[0];
    if (colab.face_token) return res.json({ erro: 'Rosto já cadastrado para este CPF.' });
    const faceToken = await detectarRosto(foto_base64);
    if (!faceToken) return res.json({ erro: 'Nenhum rosto detectado. Tente com boa iluminação.' });
    const facesetToken = await getFacesetToken();
    if (!facesetToken) return res.json({ erro: 'Erro no sistema de reconhecimento. Tente novamente.' });
    await adicionarAoFaceset(faceToken, facesetToken);
    await pool.query('UPDATE colaboradores SET face_token = $1 WHERE id = $2', [faceToken, colab.id]);
    res.json({ sucesso: true, mensagem: `Bem-vindo(a), ${colab.nome}! Rosto cadastrado com sucesso.`, colaborador: { nome: colab.nome, cargo: colab.cargo } });
  } catch (e) { res.status(500).json({ erro: 'Erro ao cadastrar: ' + e.message }); }
});

// ── REGISTRAR PONTO POR FACIAL ────────────────────────────
app.post('/ponto/facial', async (req, res) => {
  try {
    const { foto_base64 } = req.body;
    if (!foto_base64) return res.json({ erro: 'Foto obrigatória' });
    const faceToken = await detectarRosto(foto_base64);
    if (!faceToken) return res.json({ erro: 'Nenhum rosto detectado. Tente com boa iluminação.' });
    const facesetToken = await getFacesetToken();
    if (!facesetToken) return res.json({ erro: 'Sistema de reconhecimento não configurado.' });
    const faceEncontrado = await buscarNoFaceset(faceToken, facesetToken);
    if (!faceEncontrado) return res.json({ erro: 'Rosto não reconhecido. Cadastre-se primeiro.' });
    const r = await pool.query('SELECT * FROM colaboradores WHERE face_token = $1 AND ativo = true', [faceEncontrado]);
    if (r.rows.length === 0) return res.json({ erro: 'Colaborador não encontrado.' });
    const colab = r.rows[0];
    const hoje = new Date().toISOString().split('T')[0];
    const pontosHoje = await pool.query('SELECT * FROM registros_ponto WHERE colaborador_id = $1 AND DATE(data_hora) = $2 ORDER BY data_hora', [colab.id, hoje]);
    const tipos = ['ENTRADA', 'SAIDA_ALMOCO', 'RETORNO_ALMOCO', 'SAIDA'];
    const tipo = tipos[pontosHoje.rows.length] || 'SAIDA';
    await pool.query('INSERT INTO registros_ponto (colaborador_id, tipo, data_hora, reconhecimento_facial, face_token_usado) VALUES ($1, $2, NOW(), true, $3)', [colab.id, tipo, faceToken]);
    const tipoLabel = { ENTRADA: 'Entrada', SAIDA_ALMOCO: 'Saída para Almoço', RETORNO_ALMOCO: 'Retorno do Almoço', SAIDA: 'Saída' };
    res.json({ sucesso: true, colaborador: { nome: colab.nome, cargo: colab.cargo, matricula: colab.matricula }, tipo_registro: tipoLabel[tipo] || tipo, hora: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }), total_registros_hoje: pontosHoje.rows.length + 1 });
  } catch (e) { res.status(500).json({ erro: 'Erro ao registrar: ' + e.message }); }
});

// ── PONTOS DO DIA ─────────────────────────────────────────
app.get('/ponto/hoje/:matricula', autenticar, async (req, res) => {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    const r = await pool.query(`SELECT rp.* FROM registros_ponto rp JOIN colaboradores c ON c.id = rp.colaborador_id WHERE c.matricula = $1 AND DATE(rp.data_hora) = $2 ORDER BY rp.data_hora`, [req.params.matricula, hoje]);
    res.json({ registros: r.rows });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── COLABORADORES ─────────────────────────────────────────
app.get('/colaboradores', autenticar, async (req, res) => {
  try {
    const r = await pool.query('SELECT id, matricula, nome, cpf, cargo, departamento, data_admissao, perfil, face_token, ativo FROM colaboradores WHERE ativo = true ORDER BY nome');
    res.json({ colaboradores: r.rows });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.get('/colaboradores/:matricula', async (req, res) => {
  try {
    const r = await pool.query('SELECT id, matricula, nome, cargo, departamento FROM colaboradores WHERE matricula = $1 AND ativo = true', [req.params.matricula]);
    if (r.rows.length === 0) return res.json({ erro: 'Não encontrado' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.post('/colaboradores', autenticar, async (req, res) => {
  try {
    const { matricula, nome, cpf, cargo, departamento, salario, data_admissao, email, perfil, senha } = req.body;
    const senha_hash = senha ? await bcrypt.hash(senha, 10) : null;
    await pool.query('INSERT INTO colaboradores (matricula, nome, cpf, cargo, departamento, salario, data_admissao, email, perfil, senha_hash, ativo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true)', [matricula, nome, cpf, cargo, departamento || null, salario || null, data_admissao, email || null, perfil || 'COLABORADOR', senha_hash]);
    res.json({ sucesso: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── DASHBOARD RH ──────────────────────────────────────────
app.get('/rh/dashboard', autenticar, async (req, res) => {
  try {
    const hoje = new Date().toISOString().split('T')[0];
    const presentes = await pool.query(`SELECT DISTINCT ON (c.id) c.id, c.nome, c.cargo, c.departamento, rp.data_hora as entrada, rp.tipo as situacao_atual FROM colaboradores c JOIN registros_ponto rp ON rp.colaborador_id = c.id WHERE DATE(rp.data_hora) = $1 AND c.ativo = true ORDER BY c.id, rp.data_hora DESC`, [hoje]);
    const ausentes = await pool.query(`SELECT c.id, c.nome, c.matricula, c.cargo, c.departamento FROM colaboradores c WHERE c.ativo = true AND c.id NOT IN (SELECT DISTINCT colaborador_id FROM registros_ponto WHERE DATE(data_hora) = $1)`, [hoje]);
    const trabalhando = presentes.rows.filter(p => p.situacao_atual === 'ENTRADA' || p.situacao_atual === 'RETORNO_ALMOCO').length;
    const almoco = presentes.rows.filter(p => p.situacao_atual === 'SAIDA_ALMOCO').length;
    const saiu = presentes.rows.filter(p => p.situacao_atual === 'SAIDA').length;
    res.json({ resumo: { trabalhando, almoco, saiu, ausentes: ausentes.rows.length }, presentes: presentes.rows, ausentes: ausentes.rows });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── ADVERTÊNCIAS ──────────────────────────────────────────
app.post('/advertencias', autenticar, async (req, res) => {
  try {
    const { colaborador_id, tipo, motivo, descricao_detalhada, data_ocorrencia, dias_suspensao } = req.body;
    await pool.query('INSERT INTO advertencias (colaborador_id, tipo, motivo, descricao_detalhada, data_ocorrencia, dias_suspensao, status, criado_por) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [colaborador_id, tipo, motivo, descricao_detalhada, data_ocorrencia, dias_suspensao || 0, 'PENDENTE', req.usuario.id]);
    res.json({ sucesso: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── RESCISÃO ──────────────────────────────────────────────
app.post('/rescisao/calcular', autenticar, async (req, res) => {
  try {
    const { colaborador_id, tipo, data_desligamento } = req.body;
    const r = await pool.query('SELECT * FROM colaboradores WHERE id = $1', [colaborador_id]);
    if (r.rows.length === 0) return res.json({ erro: 'Colaborador não encontrado' });
    const c = r.rows[0];
    const admissao = new Date(c.data_admissao);
    const desligamento = new Date(data_desligamento);
    const mesesTrabalhados = (desligamento.getFullYear() - admissao.getFullYear()) * 12 + (desligamento.getMonth() - admissao.getMonth());
    const salario = parseFloat(c.salario) || 0;
    const saldoSalario = (salario / 30) * desligamento.getDate();
    const avisoPrevio = ['SEM_JUSTA_CAUSA', 'ACORDO_MUTUO'].includes(tipo) ? salario : 0;
    const decimoTerceiro = (salario / 12) * (desligamento.getMonth() + 1);
    const feriasProporcionais = (salario / 12) * Math.min(mesesTrabalhados, 12);
    const umTercoFerias = feriasProporcionais / 3;
    const multaFgts = tipo === 'SEM_JUSTA_CAUSA' ? salario * mesesTrabalhados * 0.08 * 0.4 : 0;
    const totalBruto = saldoSalario + avisoPrevio + decimoTerceiro + feriasProporcionais + umTercoFerias + multaFgts;
    const inss = Math.min(totalBruto * 0.14, 908.85);
    const irrf = totalBruto > 4664.68 ? totalBruto * 0.275 - 869.36 : totalBruto > 3751.05 ? totalBruto * 0.225 - 636.13 : totalBruto > 2826.65 ? totalBruto * 0.15 - 354.80 : totalBruto > 2259.20 ? totalBruto * 0.075 - 169.44 : 0;
    const totalLiquido = totalBruto - inss - irrf;
    const saldoFgts = salario * mesesTrabalhados * 0.08;
    const dataPagamento = new Date(desligamento); dataPagamento.setDate(dataPagamento.getDate() + 10);
    res.json({ colaborador: c, verbas: { saldoSalario, avisoPrevio, decimoTerceiro, feriasProporcionais, umTercoFerias, multaFgts }, descontos: { inss, irrf }, totais: { totalBruto, totalLiquido }, saldoFgts, data_pagamento: dataPagamento });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

app.post('/rescisao/iniciar', autenticar, async (req, res) => {
  try {
    const { colaborador_id, tipo, data_desligamento, motivo } = req.body;
    await pool.query('INSERT INTO rescisoes (colaborador_id, tipo, data_desligamento, motivo, status, criado_por) VALUES ($1,$2,$3,$4,$5,$6)', [colaborador_id, tipo, data_desligamento, motivo, 'PENDENTE', req.usuario.id]);
    res.json({ sucesso: true });
  } catch (e) { res.status(500).json({ erro: e.message }); }
});

// ── INICIAR ───────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
  getFacesetToken(); // cria faceset automaticamente se não existir
});
