# Telegram USDT → Fiat Bot (Node.js)

Features:
- Deposit USDT via CoinPayments (ERC20/TRC20)
- Wallet: deposit, withdraw, balance
- Sell USDT to fiat (USD, EUR, GBP)
- Payment methods: Wise, PayPal, Revolut, Bank (EU/US), Alipay, Card, Skrill, Neteller, Payeer
- Referral system: 1.5 USDT per referral, withdrawable after 50 USDT
- Admin panel via Telegram (/admin) recognized by username

## Setup

1. Clone repository
2. `cp .env.example .env` and fill credentials
3. `npm install`
4. Set PUBLIC_URL to your server domain (Sevalla domain)
5. Start: `npm start` (or use pm2: `pm2 start index.js --name usdt-bot`)

## Deployment (Sevalla)

- Push repo to GitHub.
- In Sevalla dashboard, create app, point to repo branch, set environment variables in Sevalla app settings (TELEGRAM_BOT_TOKEN, COINPAYMENTS_* etc).
- Deploy and ensure `PUBLIC_URL` is reachable from CoinPayments for IPN.
