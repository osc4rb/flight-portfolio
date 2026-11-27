// =====================================================================
//  site.js — every word on the flight portfolio lives in this one file.
//  Edit it in any text editor, save, refresh. No build step.
//  - Wrap words in **double stars** to make them bold.
//  - Delete a card/object you do not want; the page adapts.
//  - The picture is the GitHub avatar only (never a face photo).
// =====================================================================
window.FLIGHT_SITE = {
  name: "Oscar Basaula",
  callsign: "FALCON 29",
  aircraft: "f35",                 // starting jet: "f35" (F-35A) or "f47" (F-47 concept); visitors can switch
  avatar: "https://github.com/osc4rb.png?size=460",
  avatarAlt: "Oscar Basaula",

  door: { fly: "Fly in", read: "Read the CV" },
  hello: "Hi, I'm Oscar",
  tagline: "This island is my portfolio.",
  intro: "Four landmarks hold my work and radio beacons in the sky carry single projects. Fly close and they call you. Short on time? The map opens everything.",
  takeControls: "Take the controls",

  // the four landmarks; section = about | flagships | matrix | contact
  places: [
    { section: "about",     name: "The Tower",        line: "Who I am and how I work" },
    { section: "flagships", name: "Radar Hill",       line: "Flagship research and systems" },
    { section: "matrix",    name: "The Antenna Farm", line: "Everything else on the bench" },
    { section: "contact",   name: "The Lighthouse",   line: "Get in touch" },
  ],

  patches: [
    { id: "first",  name: "Wheels Up",      text: "Take the controls." },
    { id: "land",   name: "Greaser",        text: "Land back on the runway." },
    { id: "havoc",  name: "Bowling Alley",  text: "Knock over 15 things at the airbase." },
    { id: "tour",   name: "Grand Tour",     text: "Visit all four landmarks." },
    { id: "radio",  name: "All Stations",   text: "Hear every radio beacon." },
    { id: "mach",   name: "Boom",           text: "Go supersonic." },
    { id: "low",    name: "Low Pass",       text: "Under 100 ft above 300 knots." },
    { id: "roll",   name: "Aileron Roll",   text: "Roll a full 360." },
    { id: "night",  name: "Night Currency", text: "Fly 20 seconds at night." },
    { id: "recon",  name: "Recon Photo",    text: "Save a picture in photo mode." },
    { id: "reader", name: "Full Debrief",   text: "Open all four sections." },
  ],

  // pilot information file (top of the Tower section)
  pilot: {
    role: "ECE CADET · DRONES · RF · AUTONOMOUS SYSTEMS",
    lead: "Building **flight-tested drone telemetry**, **RF position-verification research** and **zero-touch automation** from first principles at the U.S. Air Force Academy — Class of 2029.",
    stats: [
      { value: "'29", label: "USAFA Class" },
      { value: "1",   label: "First-author paper in flight" },
      { value: "2",   label: "Tools live for cadets" },
    ],
    highlights: [
      { num: "01.", tag: "RESEARCH", title: "ADS-B Spoof Detection",    text: "Learned RSS radio maps + sparse TDOA on open LocaRDS data. Solo paper, AICAP 2027." },
      { num: "02.", tag: "FIELD",    title: "NASA ULI Drone Telemetry", text: "Onboard Pi logger for instrumented UAVs: synced position, IMU, wind and battery." },
      { num: "03.", tag: "SHIPPED",  title: "Zero-Touch Cadet Tooling", text: "Falcon Bullets and an automated honors-program matcher, used by real cadets." },
    ],
    skills: ["Python", "MATLAB", "C/C++", "PX4 / MAVLink", "Raspberry Pi", "SDR / RF", "scikit-learn", "Supabase", "Power Automate", "Git"],
  },

  about: {
    eyebrow: "ENGINEER PROFILE",
    title: "Background & Philosophy",
    paragraphs: [
      "I am Oscar Basaula — an Electrical & Computer Engineering cadet at the **United States Air Force Academy**, Class of 2029. I arrived with one Python course and no hardware background; within a semester I was the person on a NASA-funded capstone finding the defects nobody else had measured.",
      "My interests sit where **radio, flight and machine learning** overlap: drones that keep navigating when GPS is denied, receivers that can tell a real aircraft from a spoofed one, and loggers that time-stamp reality to the millisecond. I would rather build the first ugly version myself and explain every figure than assemble frameworks I do not understand.",
    ],
    quote: "“Publish small, ship real, and carry the hard part yourself — then scale up.”",
    principles: [
      { num: "01", title: "First Principles",   text: "Measure before modeling. Every defect I have found started with a raw log and a plot." },
      { num: "02", title: "Hardware Honesty",   text: "If it has not flown, logged or run on the bench, it is a claim, not a result." },
      { num: "03", title: "Zero-Touch Tooling", text: "Automate the boring loop once, so people get their time back every week." },
    ],
  },

  flagships: {
    eyebrow: "ARCHITECTURAL SHOWCASE",
    title: "Flagship Deployments",
    intro: "Research and systems that run on real data, real aircraft and real users.",
    feature: {
      tag: "● CORE RESEARCH",
      title: "ADS-B Position Verification — RSS Maps + Sparse TDOA",
      text: "A receiver-side spoof detector for air-traffic broadcasts. Per-receiver log-distance and gradient-boosted signal-strength maps are fused with median-referenced TDOA through calibrated p-values, so it still works when only one receiver hears the aircraft. Evaluated on the public **LocaRDS** crowdsourced dataset.",
      stats: [
        { value: "90%", label: "Far spoofs caught, RSS only, 1% FA" },
        { value: "4",   label: "LocaRDS test sets" },
        { value: "1",   label: "Receiver needed" },
        { value: "8",   label: "Pages, IEEE format" },
      ],
      layersTitle: "DETECTION PIPELINE",
      layers: [
        { tab: "S1: RSS Map", code: "STAGE 01 // RADIO MAP",  title: "Learned Per-Receiver RSS Model", text: "Log-distance path loss plus a gradient-boosted residual model per receiver, trained on honest traffic to predict the signal strength a claimed position should produce.", chips: ["scikit-learn", "Gradient boosting", "Log-distance model"] },
        { tab: "S2: TDOA",    code: "STAGE 02 // TIMING",     title: "Median-Referenced TDOA",         text: "Time-difference-of-arrival residuals taken against a median reference so receiver clock glitches do not poison the test, with no synchronized network required.", chips: ["TDOA", "Robust statistics"] },
        { tab: "S3: Fusion",  code: "STAGE 03 // DECISION",   title: "Calibrated Fisher Fusion",       text: "Per-test p-values are calibrated empirically on honest traffic, then combined with Fisher's method so the false-alarm budget actually holds in practice.", chips: ["Fisher's method", "Empirical calibration"] },
        { tab: "S4: Eval",    code: "STAGE 04 // EVALUATION", title: "Spoof Injection Benchmark",      text: "Synthetic spoofs at 100–400 km offsets plus range-preserving attacks, scored at a fixed 1% false-alarm rate across the LocaRDS test sets.", chips: ["LocaRDS", "OpenSky"] },
      ],
    },
    cards: [
      { tag: "FIELD // AEROSPACE", title: "NASA ULI — Drone Flight-Data Logger",
        text: "Onboard Raspberry Pi logger for instrumented UAVs on a NASA University Leadership Initiative capstone: synchronized position, IMU, wind and battery telemetry for energy-consumption modeling.",
        bullets: ["PX4 / MAVLink telemetry over serial", "Found mislabeled IMU units and a frozen RTC in the legacy logs", "Timestamp-sync target of 10 ms"],
        chips: ["Raspberry Pi", "PX4", "Python"] },
      { tag: "SHIPPED // CADET TOOLING", title: "Falcon Bullets — Accomplishment Tracker",
        text: "A private accomplishment log for cadets that sorts bullets into the rated areas of the performance form, so writing evaluations takes minutes instead of a weekend.",
        bullets: ["Single-file web app on GitHub Pages", "Supabase auth with row-level security", "Academy-email-only signup"],
        chips: ["JavaScript", "Supabase", "GitHub Pages"], href: "https://osc4rb.github.io/squad-tools/bullets/" },
      { tag: "AUTOMATION // ZERO-TOUCH", title: "Honors Coaching Matcher",
        text: "Scheduled matcher that pairs upper-class coaches with underclass coachees from a form response sheet, then opens the group chats automatically. The owner's only job: share the link.",
        bullets: ["Office Scripts + Power Automate", "Weighted matching with per-coach caps", "Runs once on match day and stamps the sheet"],
        chips: ["TypeScript", "Power Automate", "Teams"], href: "https://github.com/osc4rb/martinson-coaching-match" },
    ],
  },

  matrix: {
    eyebrow: "ENGINEERING INDEX",
    title: "The Systems Matrix",
    intro: "Everything else on the bench: research directions, side systems and experiments.",
    allLabel: "All Systems",
    items: [
      { category: "RF & Navigation",    id: "#SYS-01", title: "LEO Doppler Navigation for GPS-Denied Drones", text: "Low-cost satellite navigation from Iridium/Orbcomm Doppler on an RTL-SDR or HackRF, fused with the drone IMU. The cheap-oscillator drift of consumer SDRs is the core problem.", chips: ["HackRF", "RTL-SDR", "IMU fusion"], status: "In progress" },
      { category: "RF & Navigation",    id: "#SYS-02", title: "Wi-Fi CSI Sensing on ESP32",                   text: "Channel-state-information experiments on commodity ESP32 radios for low-cost sensing and device fingerprinting.", chips: ["ESP32", "CSI", "DSP"], status: "Exploring" },
      { category: "Autonomous Systems", id: "#SYS-03", title: "ARIA — Holographic Desktop Assistant",         text: "Electron desktop assistant whose WebGL hologram is the whole UI: streaming Claude as the brain, local TTS/STT and a hand-gesture layer. Eight phases, strict TypeScript.", chips: ["Electron", "React", "WebGL", "Claude API"], status: "Built" },
      { category: "Autonomous Systems", id: "#SYS-04", title: "Flight-Log Verifier",                           text: "Data-QA script for UAV logs: timestamp granularity, duplicate rows, unit sanity and sensor liveness, run before a flight is accepted.", chips: ["Python", "pandas"], status: "In progress" },
      { category: "Autonomous Systems", id: "#SYS-05", title: "Battery Telemetry Bench Test",                  text: "Bench verification of a custom ADS1115 battery-sense board against the autopilot power module; found both channels floating and traced the fix.", chips: ["ADS1115", "I2C", "Bench test"], status: "Done" },
      { category: "Tooling",            id: "#SYS-06", title: "Two-PC Sync Hub",                               text: "USB-drive based project sync between two machines with a secrets-redaction list, so work moves without touching the cloud.", chips: ["PowerShell", "Git"], status: "Daily use" },
    ],
  },

  // the home page = the résumé (also ?plain=1). Structure after husam.world/facts, dates set like henrp's portfolio.
  // Each item: when, lead (bold start), text, optional href. { sub: "..." } starts a small sub-heading.
  // Built from the 1 Nov 2026 résumé. Contact details beyond the email stay off this page.
  home: {
    lede: "Electrical & Computer Engineering cadet at the **U.S. Air Force Academy**, Class of 2029, minor in Chinese. I build drone telemetry, RF security research and tools other cadets use every week.",
    play: "Fly in",
    playNote: "the same résumé as a small 3D world",
    pdf: "Save as PDF",
    filter: "Filter",
    empty: "Nothing on the page matches that.",
    // the tabs at the top (2026-11-25, after silvjurado.com, kept black): Fly in is the front page
    tabs: { fly: "Fly in", cv: "CV", projects: "Projects", contact: "Contact" },
    // each project: tag, title, text, optional chips and href
    projects: [
      { tag: "Solo paper · AICAP 2027", title: "ADS-B position verification", text: "A receiver-side spoof detector that fuses learned signal-strength maps with sparse TDOA, so it still works when only one receiver hears the aircraft. Signal strength alone catches 90% of far spoofs at a 1% false-alarm rate on the public LocaRDS data.", chips: [ "Python", "scikit-learn", "TDOA" ] },
      { tag: "Flagship · in progress", title: "Satellite navigation without GPS", text: "A cheap receiver that finds its position from Iridium satellite Doppler on an SDR, for small drones when GPS is jammed. Aimed at the ION GNSS+ 2027 student paper competition.", chips: [ "SDR", "Doppler", "IMU fusion" ] },
      { tag: "NASA ULI · Task 1B", title: "Drone flight-data logger", text: "A Raspberry Pi Zero wired into the aircraft, a MAVLink radio link to the ground, and checks on every recorded log for NASA's electric-aircraft energy models.", chips: [ "Raspberry Pi", "MAVLink", "Python" ] },
      { tag: "NASA SUITS · team", title: "Spacesuit AR display", text: "Proposal submitted for NASA's challenge to build an augmented-reality display for spacesuits; testing at NASA Johnson in spring 2027." },
      { tag: "Shipped", title: "Falcon Bullets", text: "An accomplishment log for cadets that sorts bullets into the rated areas of the performance form, so evaluations take minutes instead of a weekend.", chips: [ "JavaScript", "Supabase" ], href: "https://osc4rb.github.io/squad-tools/bullets/" },
      { tag: "Shipped", title: "Honors coaching matcher", text: "Pairs upper-class coaches with underclass cadets from a form, then opens the group chats on match day by itself.", chips: [ "TypeScript", "Power Automate" ], href: "https://github.com/osc4rb/martinson-coaching-match" },
      { tag: "In use", title: "CS-37 squadron site", text: "One site for my squadron: the staff-summary builder, the strat scorer and Falcon Bullets.", href: "https://osc4rb.github.io/squad-tools/" },
      { tag: "Built", title: "ARIA", text: "A desktop assistant on the Claude API with a 3D interface. Camera hand-gesture control and on-screen hand effects work; voice is in progress.", chips: [ "Electron", "WebGL" ] },
      { tag: "This site", title: "The island", text: "This résumé as a 3D island you can walk, drive and fly around: Bruno Simon's open-source engine, models I built in Blender, a timed flight course and a lap leaderboard.", chips: [ "three.js", "Rapier", "Blender" ], href: "world/index.html" },
    ],
    sections: [
      { id: "research", title: "Research", say: ["Right now: flight data for NASA's electric-aircraft project, from a Pi Zero wired into the drone.", "His solo ADS-B paper went to AICAP 2027. It flags spoofed aircraft from signal strength alone.", "Next: finding position from Iridium satellite Doppler, for drones when GPS is jammed."],
        items: [
        { when: "2026–now", lead: "NASA University Leadership Initiative, Task 1B.", text: "ECE 499 under Dr. Stan Baek, on a $200K+ multi-university NASA project that models how much energy electric aircraft need, from flight data that doesn't exist yet. I wire the Raspberry Pi Zero into the aircraft, set up the MAVLink radio link to the ground, verify the recorded data and write the team's technical documentation. In the legacy logs I found a battery board that wasn't reading the battery, 100 ms timestamps with 41% duplicate rows, mislabeled IMU units and a frozen clock. Now bringing up the onboard logger on the team's delta wing. The only sophomore, alongside five seniors and two juniors." },
        { when: "2026", lead: "ADS-B position verification, solo paper.", text: "Submitted to AICAP 2027 (decision December). A receiver-side spoof detector that fuses learned signal-strength maps with sparse TDOA, so it still works when only one receiver hears the aircraft. Signal strength alone catches 90% of far spoofs at a 1% false-alarm rate on the public LocaRDS data." },
        { when: "2026–now", lead: "Satellite navigation without GPS.", text: "My flagship: a cheap receiver that finds its position from Iridium satellite Doppler on an SDR, for small drones when GPS is jammed. Aimed at the ION GNSS+ 2027 student paper competition." },
        { when: "2026", lead: "NASA SUITS, team.", text: "Proposal submitted for NASA's challenge to build an augmented-reality display for spacesuits; testing at NASA Johnson in spring 2027." },
        { when: "2026", lead: "National Collegiate Research Conference 2027, Harvard.", text: "Submitted the team's study \u201cPermitless Carry Laws and Firearm Mortality in the United States\u201d for the January conference." },
        { when: "Apr 2026", lead: "Western Regional Honors Conference, UNLV.", text: "Selected with the team to present \u201cPermitless Carry Laws and Firearm Mortality in the United States\u201d (Kim, Wang, Lee, Basaula, Kim) as a poster and talk. Learned the team's quasi-experimental methods, built the poster, and presented and defended the findings." },
        { sub: "Before the Academy" },
        { when: "2024", lead: "Journal of Student Research.", text: "Volume 13, issue 2. Published research on hydrocephalus and cranial nerve dysfunction and its socio-economic impact worldwide, mentored by Dr. Prahlad Parajuli of Wayne State University's neurosurgery department.", href: "https://doi.org/10.47611/jsrhs.v13i2.6746" },
      ] },
      { id: "building", title: "Building", say: ["Falcon Bullets turns a cadet's year into rated bullets in minutes.", "The coaching matcher pairs cadets and opens the group chats on match day by itself.", "This island runs on Bruno Simon's open-source engine. Oscar built the rest."],
        items: [
        { when: "2026–now", lead: "Falcon Bullets.", text: "An accomplishment log for cadets that sorts bullets into the rated areas of the performance form, so evaluations take minutes instead of a weekend.", href: "https://osc4rb.github.io/squad-tools/bullets/" },
        { when: "2026", lead: "Honors coaching matcher.", text: "Pairs upper-class coaches with underclass cadets from a form, then opens the group chats on match day by itself.", href: "https://github.com/osc4rb/martinson-coaching-match" },
        { when: "2026–now", lead: "CS-37 squadron site.", text: "One site for my squadron: the staff-summary builder, the strat scorer and Falcon Bullets.", href: "https://osc4rb.github.io/squad-tools/" },
        { when: "2026–now", lead: "ARIA.", text: "A desktop assistant on the Claude API with a 3D interface, built over several versions from an earlier prototype. Camera hand-gesture control and on-screen hand effects work; voice is in progress." },
        { when: "2026–now", lead: "This site.", text: "The résumé you're reading, plus a 3D island of it you can walk, drive and fly around. Built on Bruno Simon's open-source engine, with models I made in Blender, a timed flight course with a lap leaderboard, and the résumé on a computer inside the world.", href: "world/index.html" },
      ] },
      { id: "leadership", title: "Leadership", say: ["Class of 2029 representative on the Martinson honors council.", "He mentors a Class of 2030 cadet and co-writes the squadron newsletter."],
        items: [
        { when: "2026–now", lead: "Class of 2029 Representative, Martinson Cadet Leadership.", text: "Represent my class of about 80 on the honors program's council, link it to the council's leadership, and plan the study nights and socials that bring it together." },
        { when: "2026–now", lead: "Cadet Supervisor, Cadet Squadron 37.", text: "Mentor and supervise a Class of 2030 cadet through their freshman year and their adjustment to Academy life." },
        { when: "2026–now", lead: "Skyraider Scoop, Cadet Squadron 37.", text: "Write and publish the bimonthly squadron newsletter for 100+ cadets with two others: current events and squadron news." },
        { when: "2026–now", lead: "Public Affairs Officer, USAFA Forensics.", text: "Slotted to run the team's media, photography, achievements, alumni tracking and gear." },
      ] },
      { id: "honors", title: "Honors", say: ["Dean's List both semesters, and national champions with USAFA Forensics.", "Before the Academy: an NROTC national scholarship, AIME, and USABO national top 50."],
        items: [
        { when: "2026", lead: "Astronaut Scholarship Foundation.", text: "Advanced past the first stage." },
        { when: "2025–26", lead: "Dean's List, USAFA.", text: "Fall 2025 and spring 2026." },
        { when: "2025–26", lead: "YODL National Champions.", text: "Scored points for USAFA Forensics, first overall and first in points for 2025–26 on the Yaatly Online Debate League, the largest national college circuit for British Parliamentary debate." },
        { when: "Feb 2026", lead: "Second place, novice, Loyola Invitational.", text: "Individual placing in my first year on the national circuit, British Parliamentary with a partner." },
        { sub: "Before the Academy" },
        { when: "2025", lead: "Marine Option NROTC four-year national scholarship.", text: "Full tuition, fees, books and a monthly stipend, about $180,000 at the school of my choice. Selected through Marine Corps screening (academic, physical, essays) and a national board." },
        { when: "2025", lead: "AIME qualifier.", text: "Top 5% on the AMC 12." },
        { when: "2024", lead: "Coca-Cola Scholars semifinalist.", text: "One of 1,336 from more than 105,000 applicants." },
        { when: "2024", lead: "National Merit Commended Scholar.", text: "Top 2–3% of about 1.5 million PSAT/NMSQT takers." },
        { when: "2024", lead: "USA Biology Olympiad, national top 50.", text: "Of about 12,000 competitors, on the open and semifinal exams." },
      ] },
      { id: "life", title: "Outside the classroom", say: ["British Parliamentary debate on the national circuit, and tutoring for the Wing.", "Twelve years of classical piano. Guitar now too.", "This summer: special-operations field training, then the Space Force's Azimuth program."],
        items: [
        { when: "2025–now", lead: "USAFA Forensics.", text: "The Academy's nationally competitive speech and debate team. British Parliamentary debate at tournaments across the country." },
        { when: "2026–now", lead: "Wing Tutor.", text: "On the Wing roster for Computer Science 110, Chemistry 100, ECE, Law 220 and behavioral sciences: sessions before graded reviews, and a point of contact for questions." },
        { when: "Jun–Jul 2026", lead: "Cadet Warfighter Advanced Course.", text: "Field training under instructors from the Green Berets, MARSOC, Rangers, Airborne, SEALs, AFSOC and SERE: weapons handling, reconnaissance and tracking, ending in a five-day field exercise on limited resources with a non-assisted recovery." },
        { when: "Jun 2026", lead: "Azimuth.", text: "The Space Force program: briefings, base visits and industry pitches; a space-domain-awareness physics elective that ended with finding satellites and star clusters on the Academy's one-meter and half-meter telescopes; and Apollo Dagger, the closing exercise in electronic warfare, orbital warfare and missile warning." },
        { when: "2014–now", lead: "Music.", text: "Twelve years of classical study and competition under Dr. Andreas Werz, to 2023; now piano and guitar on my own." },
        { when: "2025–now", lead: "Discovery of South Asia.", text: "South Asian and Hindu cultural and festival events, and most of the weekly Hindu services at the Academy." },
        { when: "2026–now", lead: "One Light Many Flames.", text: "A weekly interfaith group comparing religious and philosophical views on questions such as AI, money, emotions and power." },
      ] },
    ],
  },

  // the 3D world's quests: messages from Oscar in the corner of the screen, one step at a time. Each step ends when
  // its `goal` achievement unlocks (the ids are in world/game/Achievements.js).
  world: {
    // the opening disc (world/game/Reveal.js): the label beside it
    intro: { start: "Click to start", tap: "Tap to start", sound: "Sound" },
    // the buttons at the top right (world/game/Hud.js): back to the home page, and the map
    nav: { back: "← Back", backTitle: "Back to the home page", map: "Map", mapTitle: "Map of the island (M)" },
    // the map (world/game/Map.js): click a place to go there
    map: { title: "The island", hint: "Click a place to go there.", flying: "Land first, then pick a place to go.", close: "Close", you: "You" },
    // labels over the places and pins on the map (world/game/Places.js); the five people use their titles from `home`
    places: { computer: "CV", jet: "Jet", truck: "Truck", circuit: "Race", blimp: "Links" },
    // the race (world/game/Course.js, Leaderboard.js). leaderboard: the Supabase project URL and its public anon key;
    // empty = times stay on each visitor's device
    race: { board: "Fastest laps", yourLap: "Your lap", name: "Your name", post: "Post", posted: "Posted", close: "Close" },
    leaderboard: { url: "", key: "" },
    // doors (world/game/Room.js): walk up and a sign shows `tab`, `name` and `go`; `label` floats over the door.
    // The one without href is the cabin by the start: it leads into the room. The others open those sites.
    doors: [
      { id: "room",    tab: "Door 1", name: "My room",          label: "Room",    go: "Go in", color: "#f2c94c" },
      { id: "bullets", tab: "Door 2", name: "Falcon Bullets",   label: "Bullets", go: "Go in", color: "#5fb3cf", href: "https://osc4rb.github.io/squad-tools/bullets/" },
      { id: "matcher", tab: "Door 3", name: "Coaching matcher", label: "Matcher", go: "Go in", color: "#9fe0b7", href: "https://github.com/osc4rb/martinson-coaching-match" },
      { id: "cs37",    tab: "Door 4", name: "CS-37 site",       label: "CS-37",   go: "Go in", color: "#ef8a6f", href: "https://osc4rb.github.io/squad-tools/" },
    ],
    // the room: hover labels and panel titles for the computer, board, shelf and phone; the shelf holds the items of
    // `home` whose lead is in `papers`
    room: {
      back: "← Back", backTitle: "Back to the island (Esc)", panelBack: "Back", screenBack: "← Back",
      labels: { computer: "CV", board: "Projects", shelf: "Papers", phone: "Contact" },
      papers: [
        "ADS-B position verification, solo paper.",
        "National Collegiate Research Conference 2027, Harvard.",
        "Western Regional Honors Conference, UNLV.",
        "Journal of Student Research.",
      ],
    },
    from: "Oscar",
    quests: [
      { goal: "takeoff",  at: "jet",      text: "Hey, welcome to my island! The jet is right behind you: walk up to it, press E, then hold W to take off." },
      { goal: "lap",      at: "circuit",  text: "Nice. See the yellow ring over the runway? Fly through it to start a lap, then follow the gates round the mountains." },
      { goal: "land",                    text: "Good flying! Now bring it down on the runway: throttle back with B and keep the wings level." },
      { goal: "computer", at: "computer", text: "The computer where you started has my résumé on its screen. Walk up to it and press E." },
      { goal: "room",     at: "room",     text: "The cabin beside the computer is my room. Walk up to the door and go in." },
      { goal: "people",   at: "people",  text: "Five people in town each hold one part of what I do. Go and say hi to all of them." },
      { goal: "blimp",    at: "blimp",    text: "The blimp circling the island carries my links. Fly close and they pop up." },
      { goal: "secret",                  text: "Last one, if you like a challenge: a gold ring is hidden high above the island." },
    ],
    done: "That's everything. Thanks for flying by!",
  },

  contact: {
    eyebrow: "DIRECT CONNECT",
    title: "Let's Build Something Extraordinary.",
    text: "Open to research collaborations, summer internships and hard problems in drones, RF and autonomy.",
    email: "obasaula@gmail.com",
    copyLabel: "Copy Email Address",
    links: [
      { label: "github.com/osc4rb", href: "https://github.com/osc4rb" },
      { label: "LinkedIn",          href: "" },          // paste your LinkedIn URL; empty = hidden
      { label: "Email me",          href: "mailto:obasaula@gmail.com" },
    ],
    footer: ["© 2026 Oscar Basaula."],
  },
};
