/* ────────────────────────────────────────────────────────────
   demo-library.js
   Curated seed for the public Calibration Bench demo. Loaded as
   a classic script; the app decorates these with ids/scheduling
   on first boot (or after Reset demo data).

   Aviation items are general FAA airman knowledge (public
   domain facts, reworded). Accounting and Learning Science
   items are original.
   ──────────────────────────────────────────────────────────── */
window.CALBENCH_DEMO_SEED = [
  /* ── Aviation · FAA Regulations & ATC ── */
  { type: "fact", discipline: "Aviation", subject: "FAA Regulations & ATC",
    name: "What are the day and night VFR fuel reserve requirements?",
    steps: ["Enough to reach the first point of intended landing plus 30 minutes at normal cruise for day VFR, and plus 45 minutes for night VFR."] },
  { type: "concept", discipline: "Aviation", subject: "FAA Regulations & ATC",
    name: "State the minimum safe altitudes over congested versus other areas.",
    steps: [
      "Over congested areas: 1,000 ft above the highest obstacle within a 2,000-ft horizontal radius",
      "Over other than congested areas: 500 ft above the surface",
      "Over open water or sparsely populated areas: no closer than 500 ft to any person, vessel, vehicle, or structure",
      "Anywhere: high enough for an emergency landing without undue hazard if power fails"] },
  { type: "concept", discipline: "Aviation", subject: "FAA Regulations & ATC",
    name: "State the meaning of each ATC light signal, in flight and on the surface.",
    steps: [
      "Steady green: in flight = cleared to land; on surface = cleared for takeoff",
      "Flashing green: in flight = return for landing (a steady green will follow); on surface = cleared to taxi",
      "Steady red: in flight = give way to other aircraft and continue circling; on surface = stop",
      "Flashing red: in flight = airport unsafe, do not land; on surface = taxi clear of the runway in use",
      "Flashing white: on surface = return to starting point on the airport (no in-flight meaning)",
      "Alternating red and green: general warning signal, exercise extreme caution (both in flight and on surface)"] },

  /* ── Aviation · Aerodynamics & Systems ── */
  { type: "concept", discipline: "Aviation", subject: "Aerodynamics & Systems",
    name: "What defines a stall aerodynamically?",
    steps: [
      "A stall occurs when the wing exceeds its critical angle of attack",
      "It can happen at any airspeed, attitude, or power setting",
      "Beyond the critical AoA, airflow separates and lift decreases sharply",
      "Recovery is by reducing angle of attack (lowering the nose)"] },
  { type: "concept", discipline: "Aviation", subject: "Aerodynamics & Systems",
    name: "Explain the relationship between load factor, bank, and stall speed.",
    steps: [
      "Load factor is the ratio of total lift to aircraft weight",
      "In a level turn, load factor increases as bank angle increases",
      "Higher load factor raises the stall speed (stall speed rises with the square root of load factor)",
      "Excessive load factor can exceed structural limits"] },
  { type: "fact", discipline: "Aviation", subject: "Aerodynamics & Systems",
    name: "What conditions are most favorable to carburetor icing?",
    steps: ["Temperatures between roughly 20°F and 70°F combined with high humidity."] },
  { type: "concept", discipline: "Aviation", subject: "Aerodynamics & Systems",
    name: "Describe the airspeed indicator color-coded arcs and markings.",
    steps: [
      "White arc: flap operating range, from VS0 (bottom) to VFE (top)",
      "Green arc: normal operating range, from VS1 to VNO",
      "Yellow arc: caution range, smooth-air only, from VNO to VNE",
      "Red line: VNE, the never-exceed speed",
      "Note: maneuvering speed (VA) is not marked on the airspeed indicator"] },

  /* ── Aviation · Weather & Aeromedical ── */
  { type: "concept", discipline: "Aviation", subject: "Weather & Aeromedical",
    name: "Describe the three stages of a thunderstorm's life cycle.",
    steps: [
      "Cumulus stage: strong updrafts as the cell builds",
      "Mature stage: updrafts and downdrafts coexist, heavy rain begins, and intensity is greatest",
      "Dissipating stage: downdrafts dominate and the cell rains itself out"] },
  { type: "fact", discipline: "Aviation", subject: "Weather & Aeromedical",
    name: "What is hypoxia?",
    steps: ["A state of oxygen deficiency in the body."] },
  { type: "concept", discipline: "Aviation", subject: "Weather & Aeromedical",
    name: "Name the five hazardous attitudes.",
    steps: [
      "Anti-authority ('Don't tell me')",
      "Impulsivity ('Do something quickly')",
      "Invulnerability ('It won't happen to me')",
      "Macho ('I can do it')",
      "Resignation ('What's the use')"] },

  /* ── Accounting · Fundamentals ── */
  { type: "fact", discipline: "Accounting", subject: "Fundamentals",
    name: "What is the accounting equation?",
    steps: ["Assets = Liabilities + Equity."] },
  { type: "concept", discipline: "Accounting", subject: "Fundamentals",
    name: "Explain how debits and credits work in double-entry bookkeeping.",
    steps: [
      "Every transaction is recorded in at least two accounts, and total debits must equal total credits",
      "Debits increase assets and expenses; credits decrease them",
      "Credits increase liabilities, equity, and revenue; debits decrease them",
      "Because both sides always balance, the accounting equation stays in balance"] },
  { type: "fact", discipline: "Accounting", subject: "Fundamentals",
    name: "What is the matching principle?",
    steps: ["Expenses are recognized in the same period as the revenues they help generate, regardless of when cash changes hands."] },
  { type: "concept", discipline: "Accounting", subject: "Fundamentals",
    name: "Contrast cash-basis and accrual-basis accounting.",
    steps: [
      "Cash basis records revenue and expenses when money actually moves",
      "Accrual basis records revenue when earned and expenses when incurred",
      "Accrual gives a truer picture of performance within a period",
      "GAAP requires accrual accounting for most companies"] },

  /* ── Learning Science · Memory & Metacognition ── */
  { type: "concept", discipline: "Learning Science", subject: "Memory & Metacognition",
    name: "What is the testing effect?",
    steps: [
      "Actively retrieving information from memory strengthens it more than re-reading or re-studying",
      "The retrieval attempt itself is the learning event, and harder (but successful) retrieval helps more",
      "Spacing retrieval attempts over time amplifies the benefit",
      "This is why this app makes you type answers from memory instead of showing them"] },
  { type: "fact", discipline: "Learning Science", subject: "Memory & Metacognition",
    name: "Why are delayed judgments of learning more accurate than immediate ones?",
    steps: ["Judging right after studying reads short-term familiarity instead of durable memory; after a delay, the judgment must probe what is actually retrievable, which predicts later recall far better."] },
  { type: "fact", discipline: "Learning Science", subject: "Memory & Metacognition",
    name: "What is the fluency illusion?",
    steps: ["Mistaking ease of processing (smooth re-reading, recognition of the material) for actual mastery; content that feels familiar often cannot be recalled when needed."] },
  { type: "concept", discipline: "Learning Science", subject: "Memory & Metacognition",
    name: "What does it mean to be well calibrated?",
    steps: [
      "Calibration is the match between confidence and actual performance",
      "A calibrated person who says 80% confident is right about 80% of the time",
      "Most people are systematically overconfident, especially on familiar material",
      "Calibration improves with feedback: predict, test, compare, repeat"] },
];
