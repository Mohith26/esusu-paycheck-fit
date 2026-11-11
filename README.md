# Paycheck Fit for Esusu Split Pay (concept demo)

**Live demo:** https://mohith26.github.io/esusu-paycheck-fit/

Esusu Split Pay lets a renter pay 60% of rent up front and repay the other 40% in two semi-monthly installments. Today those dates are the same for everyone (down payment at approval, then about 15 and 30 days after rent is due). Paycheck Fit reads the renter's linked-account history, learns when their pay actually lands, and picks the allowed dates that are least likely to come up short. It shows the renter a calibrated chance that a payment comes up short, why the dates were picked, and a calendar where they can try their own first-payment date.

Unofficial concept demo by Mohith Gajjela. Not affiliated with Esusu. All data is synthetic.

## Why

Esusu's own marketing says the point of Esusu Pay is to line rent up with paychecks ("Split your rent into biweekly payments that align with your paychecks"; the September 2026 "When is rent due?" post). The schedule itself, though, is fixed. A renter paid every other Friday can easily end up with an installment two days before payday, and for Stable Home Fund that is a returned payment. Fitting the dates to each renter is a small change in the product that helps the renter and the lender at the same time.

## What the demo shows

* **Home:** the Split Pay card plus the December rent summary with three chances side by side: pay in full on Dec 1, Split Pay on standard dates, Split Pay with Paycheck Fit.
* **Split Pay plan:** the schedule in the app's own payment-list style, the chance a payment comes up short (and what it was on standard dates), and plain reasons ("Payment 1 on Dec 7: 3 days after your Dec 4 paycheck").
* **Pick your dates:** a fan chart of the balance through December (median and the middle 8 in 10 outcomes) with paychecks and debits marked, a calendar that colors each allowed Payment 1 date by risk, and a comparison with paying in full and Affirm.
* **Backtest panel (for the Esusu Pay team):** results over a synthetic population, styled like the Esusu Dashboard.

Six renters are selectable (every-other-week, weekly, gig, paycheck-plus-gig, 15th-and-last-day). One of them (Luis) shows the honest case where the standard dates already fit.

## How it works

1. **Paycheck detection** (`src/forecast.js`): each recurring deposit source is tested against 15th/last-day, weekly and every-other-week calendars, with bank-holiday and weekend shifts to the prior business day and an estimated late-ACH rate. A source must explain at least 80% of its deposits.
2. **Bill detection:** debits that recur once a month on a stable day (rolling forward over weekends and holidays).
3. **Everything else** (everyday spending, gig payouts, transfers) is resampled in whole Monday-to-Sunday weeks from the last 13 weeks (a weekly block bootstrap), which keeps weekend spending and gig rhythm intact.
4. **Simulation:** 800 balance paths from today through Dec 31.
5. **Search** (`src/plan.js`): every allowed Split Pay schedule (down payment Nov 20-24, Payment 1 Dec 4-17, Payment 2 13-17 days later and by Dec 31, business days only) is scored on the same paths. The objective is P(any payment short) + 0.25 x P(overdraft) + a small penalty per day moved, so dates only move when it helps.
6. **Calibration** (`src/calibrate.js`): raw simulation probabilities are mapped through an isotonic regression fit on a separate calibration group of renters. That group includes the optimizer's own picks, so the "best of many noisy options" optimism is corrected too.

## Backtest

`node scripts/evaluate.mjs` builds 3,000 synthetic renters from a seeded generator (`src/generate.js`) with realistic paychecks, bank holidays, bills, overdraft fees and people cutting back when money is tight. The forecaster only sees transactions through Nov 9. Each plan is then scored on 20 December futures per renter drawn from the true generator, using the same draws for every plan.

Split Pay candidates are renters for whom paying in full on Dec 1 looked at least 10% risky and whose balance was not already below -$100: 319 of 3,000, split into 162 calibration and 157 test renters.

On the 157 test renters (3,140 renter-months), from `data/eval.json`:

| | Standard dates | Paycheck Fit |
|---|---|---|
| Any payment short (down payment or installment) | 13.8% | 9.7% |
| Installment short (lender's repayment risk) | 3.4% | 2.6% |
| Any overdraft during the cycle | 31.1% | 28.5% |

That is 29% fewer short payments. By pay pattern: every other week 4.7% to 1.8%, gig 39.1% to 29.5%, paycheck plus gig 3.8% to 2.3%, weekly 2.6% to 2.4%. Calibration error (ECE) on the test group drops from 7.0% for raw simulation to 1.6% after isotonic calibration.

## Tests

```
npm test        # node --test test/*.test.mjs (12 tests)
npm run evaluate
```

Tests cover holiday shifts, deterministic generation, paycheck detection accuracy (at least 97% of payroll renters get the exact future grid), bill recall, exact plan probabilities on hand-built paths, the product-rule constraints, that the optimizer is never worse than the standard dates on the same paths, common random numbers across plans, isotonic calibration, and consistency between the screens and the backtest file.

## Honest limitations

* All data is synthetic. Real linked-account data is messier (pending transactions, transfers between a renter's own accounts, payroll changes, multiple jobs). The generator was written by me, so the backtest checks the method, not real-world lift.
* The Split Pay date windows are my assumptions built from Esusu's help center (60% down, two semi-monthly installments, 30-day term, apply 7 business days early). The real windows and any underwriting rules would replace `RULES` in `src/plan.js`.
* Down payments and installments that come up short are counted as posting anyway (an overdraft), not as retried later. Retry logic would change the overdraft numbers, not the ranking of dates.
* The renter-facing number is a calibrated chance for this population. It should be recalibrated on real repayment outcomes before being shown to anyone.
* Gig workers improve least: with no paycheck to align to, the best the model can do is move payments away from historically thin weeks.

## Novelty

I checked Esusu's site, product snapshots (May to October 2026), the consumer and property-manager help centers (Split Pay, Affirm, Rent Relief articles) and App Store release notes (v2.5.2, Nov 9 2026). Split Pay terms are fixed semi-monthly and Affirm is two equal payments; I found no paycheck-based date selection or shortfall probability. Among competitors, Flex and Livble let renters pick their later payment dates by hand, and Livble runs a Plaid cash-flow check for eligibility. I did not find any that recommends dates from a cash-flow forecast or shows a calibrated chance a payment comes up short.

## Files

```
index.html, styles.css, app.js   the app screens and backtest panel (static, CDN fonts/icons only)
src/generate.js                  seeded synthetic renters (the "true world")
src/forecast.js                  paycheck/bill detection, block bootstrap, balance paths
src/plan.js                      product rules, plan risk, date search
src/calibrate.js                 isotonic regression, reliability, ECE, Brier, Wilson
src/engine.js                    per-renter view model used by the screens
scripts/evaluate.mjs             population backtest -> data/eval.json, data/eval.js
test/core.test.mjs               unit tests
```
