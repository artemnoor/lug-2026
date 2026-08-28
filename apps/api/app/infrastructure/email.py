"""Transactional email delivery with a safe local development mode."""

import asyncio
import smtplib
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr
from html import escape
from typing import Any

from ..http.errors import ApiError

_BRAND_STAR_PATH = (
    "M203 343 L560 536 L193 774 L589 656 L575 1021 L753 661 "
    "L1169 906 L852 545 L1318 315 L849 407 L950 196 L734 369 "
    "L562 55 L594 402 Z"
)


def _masked_email(value: str) -> str:
    local, separator, domain = value.partition("@")
    if not separator or len(local) < 3:
        return "***"
    return f"{local[:2]}***@{domain}"


def _verification_html(code: str, expires_minutes: int) -> str:
    safe_code = escape(code)
    return f"""<!doctype html>
<html lang="ru">
  <body style="margin:0;background:#dceeff;color:#07123e;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%">
    <span style="display:none!important;max-height:0;overflow:hidden;opacity:0;color:transparent">Код подтверждения для регистрации в конкурсе «Лучшая учебная группа».</span>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="padding:28px 12px 34px;background:#dceeff">
      <tr><td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:620px;background:#ffffff;border:1px solid #07123e;box-shadow:8px 8px 0 #006cdc">
          <tr><td style="height:8px;background:#006cdc;font-size:0;line-height:0">&nbsp;</td></tr>
          <tr>
            <td style="padding:28px 28px 30px;background:#dceeff">
              <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td valign="top" style="padding:0 8px 0 0">
                    <div style="font-size:12px;letter-spacing:.16em;font-weight:700;text-transform:uppercase;color:#006cdc">ЛУГ 2026</div>
                    <div style="margin-top:12px;font-size:34px;font-weight:700;letter-spacing:-.045em;line-height:.98;text-transform:uppercase;color:#07123e">Подтвердите<br>почту</div>
                    <div style="margin-top:16px;font-size:13px;line-height:1.45;color:#435170">Финальный шаг перед входом в конкурс.</div>
                  </td>
                  <td width="176" align="right" valign="top" style="padding:0">
                    <!-- Точная фирменная звезда с первого экрана. -->
                    <svg width="164" height="123" viewBox="0 0 1448 1086" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Синяя звезда ЛУГ 2026" style="display:block">
                      <path fill="#006cdc" d="{_BRAND_STAR_PATH}"/>
                    </svg>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr><td style="padding:30px 28px 34px;background:#ffffff">
            <p style="margin:0 0 17px;font-size:17px;font-weight:700;line-height:1.4;color:#07123e">Вы указали этот адрес для регистрации в конкурсе «Лучшая учебная группа».</p>
            <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:#536078">Введите код подтверждения на странице регистрации:</p>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:2px dashed #006cdc;background:#eef6ff">
              <tr><td style="padding:7px">
                <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border:1px solid #07123e;background:#ffffff">
                  <tr><td align="center" style="padding:23px 12px 20px">
                    <div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#006cdc">КОД ДОСТУПА</div>
                    <div style="margin-top:10px;font-family:'Courier New',Courier,monospace;font-size:38px;font-weight:700;letter-spacing:.22em;line-height:1;color:#07123e">{safe_code}</div>
                  </td></tr>
                </table>
              </td></tr>
            </table>
            <p style="margin:18px 0 0;font-size:14px;line-height:1.55;color:#536078">Код действует <strong style="color:#07123e">{expires_minutes} мин.</strong> Если вы не начинали регистрацию, просто проигнорируйте это письмо.</p>
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-top:25px;border-top:1px solid #c7d8ee">
              <tr><td style="padding-top:15px;font-size:13px;line-height:1.5;color:#7a88a2">Это автоматическое письмо, отвечать на него не нужно.</td>
                <td align="right" valign="bottom" width="64">
                  <!-- Светлая версия той же звезды — декоративная пара из hero. -->
                  <svg width="54" height="41" viewBox="0 0 1448 1086" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display:block">
                    <path fill="#a3c8fd" d="{_BRAND_STAR_PATH}"/>
                  </svg>
                </td>
              </tr>
            </table>
          </td></tr>
          <tr><td style="padding:18px 28px;background:#07123e;color:#ffffff;font-size:12px;line-height:1.5">
            <span style="color:#83c5ff;font-weight:700;letter-spacing:.12em;text-transform:uppercase">ЛУГ МГТУ</span><br>
            <span style="color:rgba(255,255,255,.72)">Конкурс «Лучшая учебная группа» · 2026</span>
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>"""


@dataclass
class EmailService:
    mode: str
    smtp_host: str
    smtp_port: int
    smtp_user: str
    smtp_password: str
    smtp_from: str
    smtp_from_name: str
    smtp_ssl: bool
    smtp_starttls: bool
    log_code: bool
    logger: Any

    async def send_verification_code(
        self, recipient: str, code: str, expires_minutes: int
    ) -> None:
        message = self._message(recipient, code, expires_minutes)
        if self.mode == "log":
            fields = {"recipient": _masked_email(recipient), "expiresMinutes": expires_minutes}
            if self.log_code:
                fields["code"] = code
            self.logger.info("email.verification_code", fields)
            return
        if self.mode != "smtp":
            raise ApiError(503, "Почтовая доставка временно недоступна.")
        if not self.smtp_host or not self.smtp_from:
            raise ApiError(503, "Почтовая доставка ещё не настроена организаторами.")
        try:
            await asyncio.to_thread(self._send_sync, message)
        except (OSError, smtplib.SMTPException) as exc:
            self.logger.error(
                "email.delivery_failed", {"recipient": _masked_email(recipient), "error": exc}
            )
            raise ApiError(503, "Не удалось отправить письмо. Повторите попытку позже.") from exc
        self.logger.info("email.delivered", {"recipient": _masked_email(recipient)})

    def _message(self, recipient: str, code: str, expires_minutes: int) -> EmailMessage:
        message = EmailMessage()
        sender = self.smtp_from or self.smtp_user
        message["From"] = formataddr((self.smtp_from_name, sender))
        message["To"] = recipient
        message["Subject"] = "Код подтверждения — ЛУГ 2026"
        message.set_content(
            "Ваш код подтверждения для регистрации в ЛУГ 2026: "
            f"{code}\n\nКод действует {expires_minutes} мин."
        )
        message.add_alternative(_verification_html(code, expires_minutes), subtype="html")
        return message

    def _send_sync(self, message: EmailMessage) -> None:
        if self.smtp_ssl:
            with smtplib.SMTP_SSL(
                self.smtp_host, self.smtp_port, timeout=15, context=ssl.create_default_context()
            ) as client:
                self._authenticate(client)
                client.send_message(message)
            return
        with smtplib.SMTP(self.smtp_host, self.smtp_port, timeout=15) as client:
            client.ehlo()
            if self.smtp_starttls:
                client.starttls(context=ssl.create_default_context())
                client.ehlo()
            self._authenticate(client)
            client.send_message(message)

    def _authenticate(self, client: smtplib.SMTP | smtplib.SMTP_SSL) -> None:
        if self.smtp_user:
            client.login(self.smtp_user, self.smtp_password)
