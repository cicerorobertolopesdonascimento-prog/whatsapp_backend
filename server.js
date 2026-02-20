/**
 * server.js — Backend simples para envio de e-mails (Render-friendly)
 *
 * Rotas:
 *  - GET  /             -> Health check
 *  - POST /send-email   -> Envia email com resumo e (opcional) PDF por URL
 *
 * Env vars (Render > Environment):
 *  - EMAIL_USER         -> ex: seuemail@gmail.com
 *  - EMAIL_APP_PASS     -> senha de app (Gmail) OU senha SMTP
 *  - EMAIL_FROM_NAME    -> opcional (ex: "Rota Rumo")
 *  - SMTP_HOST          -> opcional (se não usar Gmail service)
 *  - SMTP_PORT          -> opcional (ex: 587)
 *  - SMTP_SECURE        -> opcional ("true" para 465, "false" para 587)
 *
 * Requisição /send-email (JSON):
 *  {
 *    "to": "destinatario@empresa.com",
 *    "subject": "Relatório Turno B - 20/02/2026",
 *    "text": "Resumo do turno...\nOcorrências: 2\nPendências: 1\nChecklist NÃO: 3\nLink: ...",
 *    "pdfUrl": "https://.../relatorio.pdf",      // opcional
 *    "pdfFilename": "relatorio_turno_B.pdf"      // opcional
 *  }
 */

require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json({ limit: '10mb' })); // aumenta limite caso seu texto seja grande

const PORT = process.env.PORT || 3000;

// -------------------------
// Transporter SMTP (Gmail simples por padrão)
// -------------------------
function buildTransporter() {
  // Se quiser usar SMTP “genérico” (corporativo), configure SMTP_HOST/PORT.
  if (process.env.SMTP_HOST) {
    const port = Number(process.env.SMTP_PORT || 587);
    const secure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';

    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure, // true para 465, false para 587
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_APP_PASS,
      },
    });
  }

  // Default: Gmail via "service"
  return nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_APP_PASS, // senha de app (não é sua senha normal)
    },
  });
}

const transporter = buildTransporter();

// -------------------------
// Utilidades
// -------------------------
function requiredEnvOrThrow() {
  const missing = [];
  if (!process.env.EMAIL_USER) missing.push('EMAIL_USER');
  if (!process.env.EMAIL_APP_PASS) missing.push('EMAIL_APP_PASS');

  if (missing.length) {
    const msg = `Variáveis de ambiente faltando: ${missing.join(', ')}`;
    // Não derruba o processo, mas deixa explícito nos logs
    console.error(msg);
  }
}

requiredEnvOrThrow();

// -------------------------
// Rotas
// -------------------------
app.get('/', (req, res) => {
  res.status(200).send('Servidor de e-mail funcionando ✅');
});

app.post('/send-email', async (req, res) => {
  try {
    const { to, subject, text, pdfUrl, pdfFilename } = req.body || {};

    // validação mínima
    if (!to || typeof to !== 'string') {
      return res.status(400).json({ error: 'Campo "to" é obrigatório (string).' });
    }
    if (!subject || typeof subject !== 'string') {
      return res.status(400).json({ error: 'Campo "subject" é obrigatório (string).' });
    }
    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Campo "text" é obrigatório (string).' });
    }

    // anexo opcional por URL
    const attachments = [];
    if (pdfUrl) {
      if (typeof pdfUrl !== 'string') {
        return res.status(400).json({ error: 'Campo "pdfUrl" deve ser string (URL).' });
      }
      attachments.push({
        filename: (pdfFilename && String(pdfFilename)) || 'relatorio.pdf',
        path: pdfUrl, // Nodemailer faz download e anexa
        contentType: 'application/pdf',
      });
    }

    const fromName = process.env.EMAIL_FROM_NAME || 'Relatórios';
    const from = `${fromName} <${process.env.EMAIL_USER}>`;

    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      attachments,
    });

    // info.messageId existe na maioria dos SMTPs
    return res.status(200).json({
      ok: true,
      messageId: info.messageId || null,
      accepted: info.accepted || [],
      rejected: info.rejected || [],
    });
  } catch (err) {
    console.error('Erro ao enviar email:', err);
    return res.status(500).json({
      ok: false,
      error: 'Erro ao enviar email',
      details: err?.message || String(err),
    });
  }
});

// -------------------------
// Start
// -------------------------
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});