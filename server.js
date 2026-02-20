require('dotenv').config();
const express = require('express');
const { Resend } = require('resend');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

app.get('/', (req, res) => {
  res.send('Servidor de email via API funcionando 🚀');
});

app.post('/send-email', async (req, res) => {
  try {
    const { to, subject, message } = req.body;

    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ error: 'RESEND_API_KEY não configurada.' });
    }

    if (!to || !subject || !message) {
      return res.status(400).json({ error: 'Campos obrigatórios: to, subject, message' });
    }

    const resend = new Resend(process.env.RESEND_API_KEY);

    const response = await resend.emails.send({
      from: 'onboarding@resend.dev', // padrão de teste
      to: to,
      subject: subject,
      text: message
    });

    res.json({ success: true, data: response });
  } catch (error) {
    console.error(error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});