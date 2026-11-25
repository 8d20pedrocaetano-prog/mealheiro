# Import formats

All importers output rows in the `transactions` schema (DATA_MODEL §3) with ids per DATA_MODEL §4.

## 1. CGD PDF: "Consultar saldos e movimentos à ordem" (primary source)

Exported from the CGD app or website (Contas → Movimentos → export PDF). The Excel export often fails in the app,
so **PDF is the main path**. Reference parser: `reference/parse_cgd.py`; fixture:
`fixtures/cgd/synthetic-statement.pdf` → `fixtures/cgd/expected.csv`.

**Page 1 header** (labels then values on the same line):
`Cliente`, `Nº de identificação Fiscal`, `Conta <number> - EUR - <product>`, `Saldo contabilístico <x> EUR`,
`Saldo disponível`, `Período`, `Intervalo de dd-mm-yyyy a dd-mm-yyyy`, `Tipos de movimento`.
Use only the period and the closing balance (`Saldo contabilístico`). Never store the client name, NIF or
account number.

**Table:** A4, Helvetica 7.5 pt, newest movement first. ~19 rows on page 1, 35 rows on later pages, row
pitch ≈ 18.75 pt, header repeated on each page, a bank footer line at the bottom of each page.

| Column | Header | x position (pt) | Format |
|---|---|---|---|
| booking date | Data mov. | x0 ≈ 63.5 | `dd-mm-yyyy` |
| value date | Data-valor | x0 ≈ 139.3 | `dd-mm-yyyy` |
| description | Descrição | x0 ≈ 215.0 | free text, ≤ ~21 chars |
| amount | Montante | right edge ≈ 422 | pt-PT: `-1.234,56` |
| balance after | Saldo contabilístico após movimento | right edge ≈ 532 | pt-PT |

**Parsing:** group text items into lines by y (2 pt tolerance), keep lines whose first token is a date, assign
tokens to columns by x (booking < 130 ≤ value < 205 ≤ description; amount = numeric token ending before
x 440; balance = rightmost numeric token). Convert pt-PT numbers (drop `.` thousands, `,` → `.`). Reverse to
oldest first. Check the balance chain and the closing balance (DATA_MODEL §4). In the browser use
`pdfjs-dist` `getTextContent()`; item `transform[4]` = x, `transform[5]` = y (origin bottom-left).

**Description patterns** (what they mean, how the seed rules treat them):

| Pattern (description_raw) | Meaning |
|---|---|
| `COMPRA <merchant>` | card purchase (older statement format; the prefix was dropped in 2026) |
| `<merchant>` | card purchase (current format) |
| `COMPRAS C.DEB <merchant>` | card purchase via the international network: abroad or a foreign merchant. Value date = purchase date; booked 2–4 days later |
| `COMISSAO COMPRAS FORA` | fee on a non-EUR card purchase (≈2.08%), same value date as the purchase. Eurozone purchases have none |
| `TFI <NAME>` (in) | instant transfer received from a person (name truncated) |
| `TFI <OWN NAME>` (out) | instant transfer to the owner's other account (e.g. Revolut top-up) |
| `Trf Mbway 9nnXXXnnn` (out) | MB Way payment to a masked phone number |
| `TRF MBWAY` (in) | MB Way received (no name) |
| `MBWAY - RECARGAS` | mobile phone top-up via MB Way |
| `MBWAY IFTHENPAY`, `EUPAGO - …` | payment through a gateway; the real merchant is unknown |
| `LEVANTAMENTO <place>`, `ATM <place>` | cash withdrawal |
| `PayPal Europe S a r l` (out) | purchase paid with PayPal; merchant only in the PayPal export (§3) |
| `TFI PAYPAL` (in) | PayPal balance withdrawn to CGD |
| `TRF <ORGANISATION>` | bank transfer in/out (salary, tax refund `TRF REEMBOLSOS IRS`, insurers…) |
| `PORTAGENS A1`, `BX VALOR A1`, `PONTE 25 DE…` | motorway / bridge tolls |
| `PA <place>`, `A.S. <place>` | fuel station (posto de abastecimento) / motorway service area |

## 2. CGD Excel/CSV export (secondary)

Same columns as the PDF. Build when the owner provides a sample export; it must produce identical ids to the PDF
for the same movements (test with one month exported both ways).

## 3. Revolut CSV (M5)

Expected columns (verify against the owner's first real export and adjust):
`Type, Product, Started Date, Completed Date, Description, Amount, Fee, Currency, State, Balance`.

- Import only `State = COMPLETED`. `value_date` = Started Date (date part), `booking_date` = Completed Date.
- `amount` = Amount − Fee (fee as its own row if non-zero, category `bank-fees`). Keep `currency`; when not EUR,
  convert to EUR only for reporting using the EUR leg if present, otherwise flag for review.
- Top-ups from CGD appear as positive rows: categorise `transfer-revolut`. Once Revolut is imported, set the
  account `tracked=true`; CGD → Revolut transfers become neutral and Revolut purchases are itemised.

## 4. PayPal activity CSV (M5, enrichment)

Downloaded from PayPal → Activity → Statements → custom CSV. Headers depend on the account language
(`Date/Data`, `Name/Nome`, `Gross/Bruto`, `Currency/Moeda`, `Transaction ID/ID da transação`…); detect them.

Use it to **enrich**, not to add spending: match each CGD `PayPal Europe S a r l` outflow to a PayPal payment with
the same amount within ±3 days; set the display merchant from PayPal's Name and suggest a category through the
rules. Unmatched CGD PayPal rows stay in the review inbox.

## 5. Manual and generic CSV (later)

A column-mapping screen (date, description, amount, optional balance) for any other bank, saving the mapping
per account in `settings.json`.
