/**
 * server.js — ROTAS Email API (Resend) — pronto para Render
 *
 * ✅ Render: use ENV vars no painel (não dependa de .env)
 * ✅ Local: usa .env automaticamente (NODE_ENV !== 'production')
 */

if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config();
}

const express = require('express');
// const cors = require('cors'); // se precisar liberar chamadas do app/web
const { Resend } = require('resend');

const app = express();

// Se seu payload pode conter HTML grande
app.use(express.json({ limit: '2mb' }));

// Se precisar CORS (ex: front web chamando essa API)
// app.use(cors({ origin: true }));

// Render exige PORT via env
const PORT = process.env.PORT || 3000;

// ===== ENV / Branding =====
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'onboarding@resend.dev';
const RESEND_FROM_NAME = process.env.RESEND_FROM_NAME || 'Cicero Nascimento - ROTAS';

const BRAND_PRIMARY = process.env.BRAND_PRIMARY || '#111111';
const BRAND_SECONDARY = process.env.BRAND_SECONDARY || '#F2C200';
const BRAND_LOGO_URL = process.env.BRAND_LOGO_URL || '';

const REPORTS_TO_EMAIL = process.env.REPORTS_TO_EMAIL || ''; // opcional

// Reusa o client
const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

// ===== Report Notify Queue (definitivo) =====
const REPORT_NOTIFY_RETRY_SECONDS = Number(process.env.REPORT_NOTIFY_RETRY_SECONDS || 30); // 30s
const REPORT_NOTIFY_MAX_ATTEMPTS = Number(process.env.REPORT_NOTIFY_MAX_ATTEMPTS || 40);  // ~20min
const REPORT_NOTIFY_DEDUP_TTL_MIN = Number(process.env.REPORT_NOTIFY_DEDUP_TTL_MIN || 180); // 3h

// Memória simples (ok no Render se 1 instancia; se escalar, use Redis/DB)
const reportQueue = new Map();   // key -> { body, recipients, attempts, nextAt, createdAt }
const reportSent = new Map();    // key -> sentAt

// ===== Helpers =====
function asArray(value) {
  if (!value) return [];

  const list = Array.isArray(value) ? value : String(value).split(/[;,]/g);

  return list
    .map((v) => String(v).trim())
    .filter((v) => v.length > 0)
    .filter((v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)); // valida email básico
}

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function buildFromHeader() {
  const from = String(RESEND_FROM || '').trim();
  // Se já vier no formato "Nome <email>", respeita.
  if (from.includes('<') && from.includes('>')) return from;
  // Caso contrário, aplica o nome.
  return `${RESEND_FROM_NAME} <${from || 'onboarding@resend.dev'}>`;
}

function renderReportEmailHtml(payload) {
  const senderName = payload?.emailBranding?.senderDisplayName || RESEND_FROM_NAME;
  const primary = payload?.emailBranding?.primaryColorHex || BRAND_PRIMARY;
  const secondary = payload?.emailBranding?.secondaryColorHex || BRAND_SECONDARY;
  const logoUrl = payload?.emailBranding?.logoUrl || BRAND_LOGO_URL;
  const logoBase64Png = payload?.emailBranding?.logoBase64Png || null;

  const exportedBy = payload?.export?.exportedBy?.operatorName || payload?.exportedBy || 'Não informado';
  const generatedAt = payload?.generatedAt || '';
  const pdfUrl = payload?.export?.pdfUrl || payload?.pdfUrl || '';

  const summaryLines = [];
  if (payload?.route?.routeName) summaryLines.push(`Rota: ${payload.route.routeName}`);
  if (payload?.route?.unit) summaryLines.push(`Unidade: ${payload.route.unit}`);
  if (payload?.route?.shift) summaryLines.push(`Turno: ${payload.route.shift}`);

  const okPercent = payload?.checklists?.okPercent;
  if (typeof okPercent === 'number') summaryLines.push(`Checklist OK: ${okPercent}%`);

  const openPend = payload?.status?.openPendencies;
  const closedPend = payload?.status?.closedPendencies;
  if (typeof openPend === 'number' && typeof closedPend === 'number') {
    summaryLines.push(`Pendências: ${openPend} abertas / ${closedPend} fechadas`);
  }

  const openIssues = payload?.status?.openIssues;
  const closedIssues = payload?.status?.closedIssues;
  if (typeof openIssues === 'number' && typeof closedIssues === 'number') {
    summaryLines.push(`Ocorrências: ${openIssues} abertas / ${closedIssues} fechadas`);
  }

  const topOcc = Array.isArray(payload?.topOccurrences) ? payload.topOccurrences.slice(0, 3) : [];

  const summaryHtml = summaryLines.length
    ? `<ul style="margin:8px 0 0; padding-left:18px;">
        ${summaryLines.map((li) => `<li style="margin:4px 0;">${escapeHtml(li)}</li>`).join('')}
      </ul>`
    : `<div style="color:#555; margin-top:8px;">Sem resumo disponível.</div>`;

  const topOccHtml = topOcc.length
    ? `<div style="margin-top:12px;">
         <div style="font-weight:700; margin-bottom:6px;">Top 3 ocorrências</div>
         <ol style="margin:0; padding-left:18px;">
           ${topOcc
             .map(
               (o) => `<li style="margin:6px 0;">
                 <b>${escapeHtml(o.title || 'Ocorrência')}</b>
                 ${o.details ? `<div style="color:#555;">${escapeHtml(o.details)}</div>` : ''}
               </li>`,
             )
             .join('')}
         </ol>
       </div>`
    : '';

  const pdfButton = pdfUrl
    ? `<a href="${pdfUrl}" style="display:inline-block; background:${primary}; color:#fff; text-decoration:none; padding:10px 14px; border-radius:10px; font-weight:700;">
         Abrir/baixar PDF
       </a>`
    : `<div style="color:#a00; font-weight:700;">PDF ainda não disponível (upload pendente)</div>`;

  const logoSrc = logoBase64Png ? `data:image/png;base64,${logoBase64Png}` : logoUrl;

  return `
  <div style="font-family: Arial, sans-serif; background:#f6f7f9; padding:24px;">
    <div style="max-width:680px; margin:0 auto; background:#fff; border-radius:14px; overflow:hidden; border:1px solid #e7e7e7;">
      <div style="padding:18px 18px 10px; display:flex; align-items:center; justify-content:space-between; gap:12px;">
        <div style="display:flex; align-items:center; gap:10px;">
          ${logoSrc ? `<img src="${logoSrc}" alt="Logo" style="height:30px; display:block;" />` : ''}
          <div>
            <div style="font-size:14px; color:#555;">${escapeHtml(senderName)}</div>
            <div style="font-size:18px; font-weight:800;">Relatório ROTAS</div>
          </div>
        </div>
        <div style="font-size:12px; color:#777; text-align:right;">
          ${generatedAt ? escapeHtml(generatedAt) : ''}
        </div>
      </div>

      <div style="height:4px; background:${secondary};"></div>

      <div style="padding:18px;">
        <div style="color:#333;">
          Exportado por <b>${escapeHtml(exportedBy)}</b>.
        </div>

        <div style="margin-top:14px; padding:12px; background:#fafafa; border:1px solid #eee; border-radius:12px;">
          <div style="font-weight:800;">Resumo</div>
          ${summaryHtml}
          ${topOccHtml}
        </div>

        <div style="margin-top:16px;">
          ${pdfButton}
        </div>

        <div style="margin-top:14px; font-size:12px; color:#777;">
          Envio automático do ROTAS (fim de turno e exportações manuais).
        </div>
      </div>
    </div>
  </div>
  `.trim();
}

function renderReportEmailText(payload) {
  const exportedBy = payload?.export?.exportedBy?.operatorName || payload?.exportedBy || 'Não informado';
  const pdfUrl = payload?.export?.pdfUrl || payload?.pdfUrl || '(ainda não disponível)';
  const okPercent = payload?.checklists?.okPercent;
  const unit = payload?.route?.unit;
  const shift = payload?.route?.shift;

  const lines = ['Relatório ROTAS', `Exportado por: ${exportedBy}`];
  if (unit) lines.push(`Unidade: ${unit}`);
  if (shift) lines.push(`Turno: ${shift}`);
  if (typeof okPercent === 'number') lines.push(`Checklist OK: ${okPercent}%`);
  lines.push(`PDF: ${pdfUrl}`);
  return lines.join('\n');
}

function normalizeNfc(v) {
  if (v === undefined || v === null) return v;
  return String(v).normalize('NFC');
}

function ensureResendReady(res) {
  if (!RESEND_API_KEY || !resend) {
    res.status(500).json({ ok: false, error: 'RESEND_API_KEY não configurada.' });
    return false;
  }
  return true;
}

function stableKeyFromReport(body, recipients) {
  // Preferência: reportId vindo do app
  const explicit = body?.reportId || body?.export?.reportId || body?.export?.runId || body?.runId;
  if (explicit) return `rid:${String(explicit)}`;

  // fallback: combina infos comuns
  const unit = body?.route?.unit || '';
  const shift = body?.route?.shift || '';
  const generatedAt = body?.generatedAt || '';
  const pdfUrl = body?.export?.pdfUrl || body?.pdfUrl || '';
  const toKey = recipients.join(',');

  return `auto:${unit}|${shift}|${generatedAt}|${pdfUrl}|${toKey}`;
}

function isPdfReady(body) {
  const statusUploadPdf = body?.export?.statusUploadPdf || body?.statusUploadPdf || '';
  const pdfUrl = body?.export?.pdfUrl || body?.pdfUrl || '';
  const okStatus = String(statusUploadPdf).toUpperCase() === 'READY';
  const okUrl = typeof pdfUrl === 'string' && pdfUrl.trim().length > 0;
  return { ready: okStatus && okUrl, statusUploadPdf, pdfUrl };
}

function cleanupDedup() {
  const now = Date.now();
  const ttl = REPORT_NOTIFY_DEDUP_TTL_MIN * 60 * 1000;
  for (const [k, t] of reportSent.entries()) {
    if (now - t > ttl) reportSent.delete(k);
  }
}

// ===== Routes =====
app.get('/', (req, res) => {
  res.status(200).send('Servidor de email via API funcionando.');
});

app.get('/health', (req, res) => {
  res.status(200).json({ ok: true });
});

app.post('/api/reports/notify', async (req, res) => {
  try {
    if (!ensureResendReady(res)) return;

    const body = req.body || {};
    const recipients = asArray(body.to || REPORTS_TO_EMAIL);

    if (!recipients.length) {
      return res.status(400).json({
        ok: false,
        error: 'Informe "to" no body ou defina REPORTS_TO_EMAIL no ambiente.',
      });
    }

    // chave idempotente (evita duplicados)
    const key = stableKeyFromReport(body, recipients);

    // se já foi enviado, não envia de novo
    if (reportSent.has(key)) {
      return res.status(200).json({ ok: true, dedup: true, key });
    }

    // verifica se está pronto
    const { ready, statusUploadPdf, pdfUrl } = isPdfReady(body);

    console.log('[REPORT_NOTIFY] key=', key);
    console.log('[REPORT_NOTIFY] recipients=', recipients);
    console.log('[REPORT_NOTIFY] statusUploadPdf=', statusUploadPdf, 'pdfUrl=', pdfUrl);

    if (ready) {
      // envia imediatamente
      const unit = body?.route?.unit || 'Unidade';
      const shift = body?.route?.shift || 'Turno';

      const subject = body?.subject
        ? normalizeNfc(body.subject)
        : `Relatório ROTAS • ${normalizeNfc(unit)} • ${normalizeNfc(shift)}`;

      const html = normalizeNfc(renderReportEmailHtml(body));
      const text = normalizeNfc(renderReportEmailText(body));

      const response = await resend.emails.send({
        from: buildFromHeader(),
        to: recipients,
        subject,
        html,
        text,
      });

      reportSent.set(key, Date.now());

      return res.status(200).json({
        ok: true,
        sentTo: recipients.length,
        key,
        data: response,
      });
    }

    // ✅ NÃO pula: enfileira e tenta até ficar READY
    reportQueue.set(key, {
      body,
      recipients,
      attempts: 0,
      createdAt: Date.now(),
      nextAt: Date.now() + 1000, // tenta em 1s
    });

    return res.status(202).json({
      ok: true,
      queued: true,
      key,
      statusUploadPdf,
      pdfUrl,
      recipientsCount: recipients.length,
      retryEverySeconds: REPORT_NOTIFY_RETRY_SECONDS,
      maxAttempts: REPORT_NOTIFY_MAX_ATTEMPTS,
    });
  } catch (error) {
    const msg = error?.message || String(error);
    console.error('Erro /api/reports/notify:', msg, error);
    return res.status(500).json({ ok: false, error: msg });
  }
});
/**
 * ✅ Endpoint: recebe JSON do relatório e envia e-mail com layout
 * Regra: NÃO envia se pdfUrl estiver vazio ou statusUploadPdf != READY
 */
app.post('/api/reports/notify', async (req, res) => {
  try {
    if (!ensureResendReady(res)) return;

    const body = req.body || {};
    const statusUploadPdf = body?.export?.statusUploadPdf || body?.statusUploadPdf || '';
    const pdfUrl = body?.export?.pdfUrl || body?.pdfUrl || '';

    // ✅ calcula recipients SEMPRE (para log e debug)
    const recipients = asArray(body.to || REPORTS_TO_EMAIL);

    console.log('[REPORT_NOTIFY] parsed recipients:', recipients);
    console.log('[REPORT_NOTIFY] statusUploadPdf:', statusUploadPdf);
    console.log('[REPORT_NOTIFY] pdfUrl:', pdfUrl);

    if (!recipients.length) {
      return res.status(400).json({
        ok: false,
        error: 'Informe "to" no body ou defina REPORTS_TO_EMAIL no ambiente.',
        recipients,
      });
    }

    // ✅ NÃO envia e-mail se ainda não tem PDF (READY + URL)
    if (!pdfUrl || String(statusUploadPdf).toUpperCase() !== 'READY') {
      return res.status(200).json({
        ok: true,
        skipped: true,
        reason: 'PDF not ready',
        statusUploadPdf,
        pdfUrl,
        recipients,
      });
    }

    console.log('[REPORT_NOTIFY] eventType:', body?.eventType);
    console.log('[REPORT_NOTIFY] exportedBy:', body?.export?.exportedBy?.operatorName);

    const unit = body?.route?.unit || 'Unidade';
    const shift = body?.route?.shift || 'Turno';

    const subject = body?.subject
      ? normalizeNfc(body.subject)
      : `Relatório ROTAS • ${normalizeNfc(unit)} • ${normalizeNfc(shift)}`;

    const html = normalizeNfc(renderReportEmailHtml(body));
    const text = normalizeNfc(renderReportEmailText(body));

    const response = await resend.emails.send({
      from: buildFromHeader(),
      to: recipients,
      subject,
      html,
      text,
    });

    return res.status(200).json({ ok: true, sentTo: recipients.length, data: response });
  } catch (error) {
    const msg = error?.message || String(error);
    console.error('Erro /api/reports/notify:', msg, error);
    return res.status(500).json({ ok: false, error: msg });
  }
});

// ✅ MUITO IMPORTANTE: manter o processo vivo no Render
async function processQueueTick() {
  try {
    cleanupDedup();
    const now = Date.now();

    for (const [key, job] of reportQueue.entries()) {
      if (job.nextAt > now) continue;

      const { ready, statusUploadPdf, pdfUrl } = isPdfReady(job.body);

      console.log('[QUEUE] key=', key, 'attempt=', job.attempts, 'ready=', ready, 'status=', statusUploadPdf);

      if (!ready) {
        job.attempts += 1;

        if (job.attempts >= REPORT_NOTIFY_MAX_ATTEMPTS) {
          console.log('[QUEUE] give up key=', key, 'status=', statusUploadPdf, 'pdfUrl=', pdfUrl);
          reportQueue.delete(key);
          continue;
        }

        job.nextAt = now + REPORT_NOTIFY_RETRY_SECONDS * 1000;
        continue;
      }

      // Já enviado? (dedup)
      if (reportSent.has(key)) {
        console.log('[QUEUE] already sent key=', key);
        reportQueue.delete(key);
        continue;
      }

      // Envia
      const body = job.body;
      const recipients = job.recipients;

      const unit = body?.route?.unit || 'Unidade';
      const shift = body?.route?.shift || 'Turno';

      const subject = body?.subject
        ? normalizeNfc(body.subject)
        : `Relatório ROTAS • ${normalizeNfc(unit)} • ${normalizeNfc(shift)}`;

      const html = normalizeNfc(renderReportEmailHtml(body));
      const text = normalizeNfc(renderReportEmailText(body));

      const response = await resend.emails.send({
        from: buildFromHeader(),
        to: recipients,
        subject,
        html,
        text,
      });

      reportSent.set(key, Date.now());
      reportQueue.delete(key);

      console.log('[QUEUE] sent key=', key, 'sentTo=', recipients.length, 'res=', response?.data?.id || 'ok');
    }
  } catch (e) {
    console.error('[QUEUE] tick error:', e?.message || String(e), e);
  }
}

// roda a cada 5s
setInterval(processQueueTick, 5000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ API listening on ${PORT}`);
  console.log(`✅ NODE_ENV=${process.env.NODE_ENV || '(not set)'}`);
});