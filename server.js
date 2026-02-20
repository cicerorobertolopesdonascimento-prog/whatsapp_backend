require('dotenv').config();
const express = require('express');
const nodemailer = require('nodemailer');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Configuração do Gmail
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Rota teste
app.get('/', (req, res) => {
  res.send('Servidor de email funcionando 🚀');
});

// Enviar email
app.post('/send-email', async (req, res) => {
  try {
    const { to, subject, message } = req.body;

    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: to,
      subject: subject,
      text: message
    });

    res.json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao enviar email' });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});