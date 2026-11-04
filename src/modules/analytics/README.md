# analytics (Stage 15)

First-party, pseudonymous product analytics: the typed event catalogue (`events.ts`), the recorder
(`recordEvent`, inside the business transaction), funnel/cohort queries with small-cell suppression, daily rollups and
24-month retention. Never imports the `fin` schema; events carry no personal or financial data.
