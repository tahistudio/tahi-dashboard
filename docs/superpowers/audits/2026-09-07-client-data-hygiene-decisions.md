# Client data hygiene: Liam's decisions (7 Sep 2026, 10:00 to 10:40 NZST)

Applied already through the client API as Liam (audited):
- "Charles Bilash" organisation renamed to Verandela (fa38bb6a). Charles stays the contact.
- Ten failed-deal organisations moved from active to prospect: Alumni Capital, Avery Cox (Tattoo Expo Platform), Emusio, Happy Monday, IKON VAULT, ILFP Legal Partners LLC, ProfitableLO, SafeRec, St Stephen's Anglican Church, iTANZ / Integration Xperts ANZ. Real leads, never clients.
- Lingorama moved to active (just won).

To apply once the merge, delete, contact and subscription endpoints land (all super admin, all audited, no email):
- Verandela: merge the archived shell "Charles Bilash (DUPLICATE, do not use)" (30eb921b, Xero contact id 038af83f, one paid Xero invoice USD 9,000 of 6 Jul 2026) into fa38bb6a; merge contact 9cb67733 (4 request references) into the ManyRequests contact 5d98f8a1.
- Assertio: real, Bharat Kochar is the contact; merge duplicate contact 0aee6c97 into 1b573c9f; clear the launch plan.
- Tevalis: real, a failed deal; remove its two test scale subscriptions (83863302, f50dce70) and their four empty tracks; merge the duplicate Jocelyn de Goey contact; stays prospect.
- ISO Certification Experts: remove the test scale subscription bfd69fe4 and its two empty tracks; clear the plan.
- Tara Winery: always a prospect; the prospect row 22f584a1 survives, merge the active zero-contact row 2c4d26bd into it, then merge its duplicate contact.
- Acme Widgets Test: dummy; delete with its six Stripe test invoices (org ee8e83b6, customer cus_Umg4sMjWGzkulh).
- Physitrack: merge the three Evan Kwan Stripe shells (c4ed4811, 2859abca, fbab8478, customer cus_Sm4dmnkwzZp2Zn) into b92b9f2f; then dedupe the invoice-plus-charge pairs the Stripe import recorded twice (four pairs on those shells, one on Dante Media).
- Clear the launch plan on Alumni Capital, Avery Cox, Emusio, IKON VAULT, ProfitableLO and both Tara Winery rows; merge the remaining exact-duplicate contacts at Alumni Capital, Avery Cox, Happy Monday, IKON VAULT, ProfitableLO, SafeRec.

Also asked: Xero draft invoices must not count as money owed anywhere (studio home, reports, aging, client Money tab) and must never show to clients; they stay visible to the studio as drafts. Builder running.
