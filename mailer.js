const nodemailer = require('nodemailer');

// Envio de mails por Gmail SMTP (con una "contraseña de aplicación" de la
// cuenta de Google, no la contraseña normal). Si no esta configurado, no
// rompe nada: simplemente no se manda el mail y se loguea un aviso, asi el
// resto de la app sigue andando igual.
const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD;
const MAIL_ENABLED = !!(GMAIL_USER && GMAIL_APP_PASSWORD);

let transporter = null;
if (MAIL_ENABLED) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
}

async function sendResetPasswordEmail(toEmail, resetUrl) {
  if (!MAIL_ENABLED) {
    console.warn(`[mailer] GMAIL_USER/GMAIL_APP_PASSWORD no configurados: no se pudo enviar el mail de recuperacion a ${toEmail}. Link: ${resetUrl}`);
    return false;
  }
  await transporter.sendMail({
    from: `"Editor de Video de Dematiu" <${GMAIL_USER}>`,
    to: toEmail,
    subject: 'Recuperá tu contraseña',
    text: `Pediste recuperar tu contraseña. Entrá a este link para elegir una nueva (vale por 1 hora):\n\n${resetUrl}\n\nSi no fuiste vos, ignorá este mail.`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>🎬 Editor de Video de Dematiu</h2>
        <p>Pediste recuperar tu contraseña. Hacé click en el botón para elegir una nueva (el link vale por 1 hora):</p>
        <p style="text-align: center; margin: 28px 0;">
          <a href="${resetUrl}" style="background:#6c5ce7;color:#fff;padding:14px 28px;border-radius:10px;text-decoration:none;font-weight:bold;display:inline-block;">Elegir nueva contraseña</a>
        </p>
        <p style="color:#888;font-size:13px;">Si no fuiste vos quien lo pidió, podés ignorar este mail tranquilamente.</p>
      </div>
    `,
  });
  return true;
}

module.exports = { sendResetPasswordEmail, MAIL_ENABLED };
