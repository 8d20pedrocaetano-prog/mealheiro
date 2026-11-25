# Mealheiro

A personal spending and savings app: an installable web app (phone + laptop) over CSV files that live in your
own private GitHub repo. No server, no third parties.

- **App repo** (this one, public): the code. Deployed to GitHub Pages.
- **Data repo** (`mealheiro-data`, private): your transactions, rules, events, budgets and goals as CSV, plus the
  tools and skill an ingest session uses to import bank statements.

Docs: [SPEC](docs/SPEC.md) · [DATA_MODEL](docs/DATA_MODEL.md) · [ARCHITECTURE](docs/ARCHITECTURE.md) ·
[ROADMAP](docs/ROADMAP.md) · [IMPORT_FORMATS](docs/IMPORT_FORMATS.md). Builder instructions: [CLAUDE.md](CLAUDE.md).

## Setup (once)

1. **Data repo:** create a *private* repo `mealheiro-data` and push the seed folder into it.
2. **App repo:** create a *public* repo `mealheiro`, push this folder, enable Pages (Settings → Pages → GitHub
   Actions). The workflow is part of milestone M0.
3. **Token:** GitHub → Settings → Developer settings → Fine-grained tokens → *Only select repositories:*
   `mealheiro-data` → *Contents: Read and write* → 1-year expiry.
4. **Phone:** open `https://<you>.github.io/mealheiro/` in Chrome → menu → *Install app* → connect with the
   token → set a PIN. Same on the laptop.

## Monthly routine

1. CGD app → movements → export PDF (Excel if it works).
2. Open a Claude session on `mealheiro-data` with a cheaper model, attach the PDF, say **"ingest this statement"**.
3. Open Mealheiro → clear the review inbox → confirm proposed trips → check budgets.

From milestone M5 you can share the PDF straight from the CGD app into Mealheiro instead.

## Privacy

Never commit real statements or data to this repo. `fixtures/` is synthetic (fake person, fake account).
