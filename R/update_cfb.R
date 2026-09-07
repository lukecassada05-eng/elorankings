# ================================================================
# R/update_cfb.R  —  College Football Elo, 2001–current
# Data: ESPN scoreboard API (dates=YYYYMMDD, groups=80 for FBS)
#
# KEY: get_conf(team, year) handles ALL known ESPN shortDisplayName
# variants and every conference realignment from 2001–present.
# ================================================================
suppressPackageStartupMessages({
  library(dplyr); library(readr); library(httr); library(jsonlite)
})
source("R/elo_engine.R")

CURRENT_YEAR <- as.integer(format(Sys.Date(), "%Y"))
if (as.integer(format(Sys.Date(), "%m")) < 8) CURRENT_YEAR <- CURRENT_YEAR - 1
SEASONS <- 2001:(CURRENT_YEAR + 1L)  # +1 catches next season if started
OUT_DIR  <- "docs/CFB/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

# ================================================================
# Year-aware conference assignment
# Handles ESPN shortDisplayName variants + all realignments
# ================================================================
# ================================================================
# get_conf(team, year)
# Year-aware conference assignment for all FBS teams 2001-present.
#
# Strategy:
#   1. Normalise ESPN shortDisplayName → canonical name via ALIASES
#   2. Look up canonical name in year-aware conference logic
#
# This handles all ESPN name variants (abbreviations, dot-notation,
# historical names) and every conference realignment since 2001.
# ================================================================

# ── Alias map: every ESPN variant -> canonical team name ────────
# Extracted to R/cfb_aliases.R so update_cfb_playoff.R can reuse the
# exact same table without re-running this whole pipeline via source().
# Add new variants there; the conference logic below stays clean.
source("R/cfb_aliases.R")

# ── Canonical conference map (STATIC FALLBACK ONLY) ─────────────
# Uses canonical names only (after alias resolution).
# Year-aware via function logic below.
#
# NOTE: as of the auto-realignment update below, this hand-maintained
# table is no longer the primary source for the current season — it's
# kept as a safety net for (a) all historical seasons, which are settled
# and don't need live lookups, and (b) any team the live ESPN lookup
# doesn't cover. See fetch_cfb_conf_map() / get_conf() further down.
get_conf_static <- function(team, year) {
  t <- trimws(team)

  # Step 1: Resolve alias to canonical name
  if (t %in% names(ALIASES)) t <- ALIASES[[t]]

  # Step 2: Look up by canonical name with year logic

  # ── Permanent independents ─────────────────────────────────
  if (t == "Notre Dame") return("Independent")
  if (t == "Army") {
    if (year >= 2024) return("AAC")   # joined AAC 2024 as football-only member
    return("Independent")
  }
  if (t == "Navy") {
    if (year >= 2015) return("AAC")   # joined AAC 2015, still member
    return("Independent")
  }
  if (t == "BYU") {
    if (year <= 2010) return("Mountain West")
    if (year <= 2022) return("Independent")
    return("Big 12")
  }
  if (t == "Massachusetts") {
    if (year >= 2024) return("MAC")        # rejoined MAC 2024
    if (year >= 2016) return("Independent") # independent 2016-2023
    if (year >= 2012) return("MAC")        # FBS MAC member 2012-2015
    return("FCS")                          # FCS before 2012
  }
  if (t == "UConn") {
    if (year >= 2020) return("Independent")
    if (year >= 2013) return("AAC")
    return("Big East")
  }
  if (t == "Liberty") {
    if (year >= 2023) return("C-USA")
    if (year >= 2018) return("Independent")
    return("FCS")   # FCS Southland until 2017
  }
  if (t == "New Mexico State") {
    if (year >= 2023) return("C-USA")
    if (year >= 2018) return("Independent")
    if (year >= 2005) return("WAC")   # joined WAC 2005, dropped to FCS after 2017
    return("FCS")   # FCS Southland until 2004
  }
  if (t == "Sam Houston") {
    if (year >= 2021) return("C-USA")
    return("FCS")
  }

  # ── ACC ────────────────────────────────────────────────────
  acc_stable <- c("Clemson","Miami","NC State","Duke","Virginia","Virginia Tech",
                  "Georgia Tech","Wake Forest","Wake Forest","Boston College")
  if (t %in% acc_stable) return("ACC")
  if (t == "Pittsburgh") {
    if (year >= 2013) return("ACC")
    return("Big East")
  }
  if (t == "Syracuse") {
    if (year >= 2013) return("ACC")
    return("Big East")
  }
  if (t == "Louisville") {
    if (year >= 2014) return("ACC")
    if (year >= 2013) return("AAC")   # Big East renamed to AAC July 2013
    return("Big East")
  }
  if (t == "Wake Forest") return("ACC")
  if (t == "North Carolina") return("ACC")
  if (t == "Florida St")     return("ACC")
  if (t == "Maryland") {
    if (year >= 2014) return("Big Ten")
    return("ACC")
  }
  if (t %in% c("Stanford","California")) {
    if (year >= 2024) return("ACC")
    return("Pac-12")
  }
  if (t == "SMU") {
    if (year >= 2024) return("ACC")
    if (year >= 2013) return("AAC")
    return("C-USA")
  }

  # ── BIG TEN ────────────────────────────────────────────────
  b10_stable <- c("Michigan","Ohio State","Penn State","Michigan State","Minnesota","Wisconsin",
                  "Iowa","Purdue","Illinois","Indiana","Northwestern")
  if (t %in% b10_stable) return("Big Ten")
  if (t == "Maryland"  && year >= 2014) return("Big Ten")
  if (t == "Rutgers") {
    if (year >= 2014) return("Big Ten")
    if (year >= 2013) return("AAC")   # Big East renamed to AAC July 2013
    return("Big East")
  }
  if (t %in% c("UCLA","USC")       && year >= 2024) return("Big Ten")
  if (t == "Washington"            && year >= 2024) return("Big Ten")
  if (t == "Oregon"                && year >= 2024) return("Big Ten")

  # ── BIG 12 ────────────────────────────────────────────────
  b12_stable <- c("Kansas","Kansas State","Iowa State","Baylor","Texas Tech","Oklahoma State")
  if (t %in% b12_stable) return("Big 12")
  if (t == "TCU") {
    if (year >= 2012) return("Big 12")
    return("Mountain West")
  }
  if (t == "West Virginia") {
    if (year >= 2012) return("Big 12")
    return("Big East")
  }
  if (t == "Texas") {
    if (year >= 2024) return("SEC")
    return("Big 12")
  }
  if (t == "Oklahoma") {
    if (year >= 2024) return("SEC")
    return("Big 12")
  }
  if (t == "Colorado") {
    if (year >= 2024) return("Big 12")
    if (year >= 2011) return("Pac-12")
    return("Big 12")
  }
  if (t == "Nebraska") {
    if (year >= 2011) return("Big Ten")
    return("Big 12")
  }
  if (t == "Missouri") {
    if (year >= 2012) return("SEC")
    return("Big 12")
  }
  if (t == "Texas A&M") {
    if (year >= 2012) return("SEC")
    return("Big 12")
  }
  if (t %in% c("BYU") && year >= 2023) return("Big 12")
  if (t %in% c("Cincinnati","UCF","Houston") && year >= 2023) return("Big 12")
  if (t %in% c("Arizona","Arizona State","Utah") && year >= 2024) return("Big 12")

  # ── SEC ────────────────────────────────────────────────────
  sec_stable <- c("Alabama","Georgia","LSU","Florida","Tennessee","Auburn",
                  "Ole Miss","Miss St","Arkansas","Kentucky","South Carolina","Vanderbilt")
  if (t %in% sec_stable) return("SEC")
  if (t == "Missouri"  && year >= 2012) return("SEC")
  if (t == "Texas A&M" && year >= 2012) return("SEC")
  if (t == "Texas"     && year >= 2024) return("SEC")
  if (t == "Oklahoma"  && year >= 2024) return("SEC")

  # ── PAC-10 / PAC-12 ───────────────────────────────────────
  pac_stable <- c("Oregon","Oregon State","UCLA","USC","Arizona","Arizona State",
                  "Washington","Washington State","California","Stanford")
  if (t %in% pac_stable) {
    if (year >= 2024) {
      if (t %in% c("UCLA","USC")) return("Big Ten")
      if (t %in% c("Arizona","Arizona State")) return("Big 12")
      if (t %in% c("California","Stanford")) return("ACC")
      if (t == "Oregon") return("Big Ten")
      return("Pac-12")  # Oregon State, Washington State remain
    }
    return("Pac-12")
  }
  if (t == "Utah") {
    if (year >= 2024) return("Big 12")
    if (year >= 2011) return("Pac-12")
    return("Mountain West")
  }
  if (t == "Colorado") {
    if (year >= 2024) return("Big 12")
    if (year >= 2011) return("Pac-12")
    return("Big 12")
  }

  # ── MOUNTAIN WEST ──────────────────────────────────────────
  # MWC teams that LEFT for re-formed Pac-12 in 2026
  if (t %in% c("Boise State","Colorado State","Fresno State","San Diego State","Utah State")) {
    if (year >= 2026) return("Pac-12")
    if (t == "Boise State") {
      if (year >= 2011) return("Mountain West")
      return("WAC")
    }
    if (t %in% c("Fresno State","San Jose State")) {
      if (year >= 2012) return("Mountain West")
      return("WAC")
    }
    if (t == "Utah State") {
      if (year >= 2013) return("Mountain West")
      return("WAC")
    }
    return("Mountain West")  # Colorado State, San Diego State: MWC founding
  }
  # Pure MWC founding members staying in MWC
  mw_founding <- c("UNLV","Wyoming","New Mexico","Air Force")
  if (t %in% mw_founding) return("Mountain West")
  # WAC teams that joined MWC and stayed
  if (t %in% c("Nevada","San Jose State","Hawai'i")) {
    if (year >= 2012) return("Mountain West")
    return("WAC")
  }
  # NDSU joins MWC 2026
  if (t %in% c("North Dakota State","NDSU")) {
    if (year >= 2026) return("Mountain West")
    return("FCS")
  }
  if (t == "Utah"     && year <= 2010) return("Mountain West")
  if (t == "BYU"      && year <= 2010) return("Mountain West")
  if (t == "TCU"      && year <= 2011) return("Mountain West")
  if (t == "Colorado" && year <= 2010) return("Mountain West")

  # ── AAC (2013+) / BIG EAST football (2001-2012) ───────────
  # Per-team year logic for accurate conference history

  # Cincinnati: Big East 2001-2012, AAC 2013-2022, Big 12 2023+
  if (t == "Cincinnati") {
    if (year >= 2023) return("Big 12")
    if (year >= 2013) return("AAC")
    return("Big East")
  }
  # South Florida: Ind 2001-2004, Big East 2005-2012, AAC 2013+
  if (t == "South Florida") {
    if (year >= 2013) return("AAC")
    if (year >= 2005) return("Big East")
    return("Independent")
  }
  # Temple: MAC 2001-2011, Big East 2012, AAC 2013+
  if (t == "Temple") {
    if (year >= 2013) return("AAC")
    if (year >= 2012) return("Big East")
    return("MAC")
  }
  # Houston: C-USA 2001-2012, AAC 2013-2022, Big 12 2023+
  if (t == "Houston") {
    if (year >= 2023) return("Big 12")
    if (year >= 2013) return("AAC")
    return("C-USA")
  }
  # UCF: C-USA 2002-2012 (FCS before), AAC 2013-2022, Big 12 2023+
  if (t == "UCF") {
    if (year >= 2023) return("Big 12")
    if (year >= 2013) return("AAC")
    if (year >= 2002) return("C-USA")
    return("FCS")
  }
  # Memphis: C-USA 2001-2012, AAC 2013+
  if (t == "Memphis") {
    if (year >= 2013) return("AAC")
    return("C-USA")
  }
  # SMU: C-USA 2001-2012, AAC 2013-2023, ACC 2024+
  if (t == "SMU") {
    if (year >= 2024) return("ACC")
    if (year >= 2013) return("AAC")
    return("C-USA")
  }
  # Tulsa: WAC 2001-2004, C-USA 2005-2013, AAC 2014+
  if (t == "Tulsa") {
    if (year >= 2014) return("AAC")
    if (year >= 2005) return("C-USA")
    return("WAC")
  }
  # East Carolina: C-USA 2001-2013, AAC 2014+
  if (t == "East Carolina") {
    if (year >= 2014) return("AAC")
    return("C-USA")
  }
  # Tulane: C-USA 2001-2004, Independent 2005-2013, AAC 2014+
  if (t == "Tulane") {
    if (year >= 2014) return("AAC")
    if (year >= 2005) return("Independent")
    return("C-USA")
  }
  # North Texas: Sun Belt 2001-2012, C-USA 2013-2023, AAC 2024+
  if (t == "North Texas") {
    if (year >= 2023) return("AAC")
    if (year >= 2013) return("C-USA")
    return("Sun Belt")
  }
  # UAB: C-USA all years (left 2014-2016, returned 2017), AAC 2024+
  # (UAB suspended program 2015-2016, returned C-USA 2017)
  if (t == "UAB") {
    if (year >= 2023) return("AAC")
    if (year >= 2017) return("C-USA")
    if (year >= 2015) return("Independent")   # program suspended
    return("C-USA")
  }
  # Wichita State: no football program
  # Charlotte: FCS through 2014, C-USA 2015-2022, AAC 2023+
  if (t == "Charlotte") {
    if (year >= 2023) return("AAC")
    if (year >= 2015) return("C-USA")
    return("FCS")
  }
  # UTSA: FCS until 2012, C-USA 2013-2022, AAC 2023+
  if (t == "UTSA") {
    if (year >= 2023) return("AAC")
    if (year >= 2013) return("C-USA")
    return("FCS")
  }
  # Big East football teams (2001-2012) not handled above
  big_east_fb <- c("Rutgers","Pittsburgh","West Virginia","Louisville","Syracuse","UConn","Navy")
  if (t %in% big_east_fb && year <= 2012) return("Big East")

  # ── SUN BELT ──────────────────────────────────────────────
  sunbelt_stable <- c("Louisiana","Troy","App State","Arkansas State","Georgia Southern",
                      "Georgia State","South Alabama","UL Monroe",
                      "Coastal Carolina","Old Dominion","James Madison",
                      "Marshall")
  # Southern Miss: C-USA 2001-2012, Sun Belt 2013+
  if (t == "Southern Miss") {
    if (year >= 2013) return("Sun Belt")
    return("C-USA")
  }
  # Texas State: FCS until 2011, WAC 2012, Sun Belt 2013-2025, Pac-12 2026+
  if (t == "Texas State") {
    if (year >= 2026) return("Pac-12")
    if (year >= 2013) return("Sun Belt")
    if (year >= 2012) return("WAC")
    return("FCS")
  }
  if (t %in% sunbelt_stable) {
    if (t == "Marshall") {
      if (year >= 2022) return("Sun Belt")
      if (year >= 2005) return("C-USA")
      return("MAC")
    }
    if (t == "Old Dominion") {
      if (year >= 2022) return("Sun Belt")
      if (year >= 2014) return("C-USA")
      return("FCS")  # FCS CAA until 2012
    }
    if (t == "App State") {
      if (year >= 2014) return("Sun Belt")
      return("FCS")
    }
    if (t == "James Madison") {
      if (year >= 2023) return("Sun Belt")
      return("FCS")
    }
    if (t == "South Alabama" && year < 2012) return("FCS")
    if (t == "Georgia State" && year < 2013) return("FCS")
    if (t == "Coastal Carolina" && year < 2017) return("FCS")
    if (t %in% c("Southern Miss","Texas State") && year <= 2012) return("C-USA")
    return("Sun Belt")
  }

  # ── C-USA ─────────────────────────────────────────────────
  cusa_current <- c("UAB","Middle Tennessee","Western Kentucky","Florida Atlantic","FIU",
                    "UTEP","Rice","Kennesaw State","Jacksonville State",
                    "Sam Houston","Liberty","New Mexico State","UTSA","Louisiana Tech")
  # UTEP: WAC 2001-2004, C-USA 2005+
  if (t == "UTEP") {
    if (year >= 2005) return("C-USA")
    return("WAC")
  }
  if (t %in% cusa_current) {
    if (t == "Louisiana Tech") {
      if (year >= 2026) return("Sun Belt")  # left C-USA for Sun Belt, effective July 1, 2026
      if (year >= 2013) return("C-USA")
      return("WAC")   # WAC 2001-2012
    }
    if (t == "Middle Tennessee") {
      if (year >= 2013) return("C-USA")
      return("Sun Belt")   # Sun Belt 2001-2012
    }
    if (t == "Western Kentucky") {
      if (year >= 2013) return("C-USA")
      if (year >= 2009) return("Sun Belt")
      return("FCS")
    }
    if (t == "Florida Atlantic") {
      if (year >= 2023) return("AAC")
      if (year >= 2013) return("C-USA")
      if (year >= 2001) return("Sun Belt")
      return("FCS")
    }
    if (t == "FIU") {
      if (year >= 2009) return("C-USA")
      if (year >= 2001) return("Sun Belt")
      return("FCS")
    }
    if (t == "Rice") {
      if (year >= 2023) return("AAC")
      return("C-USA")
    }
    if (t == "UTSA" && year < 2013) return("FCS")
    if (t == "Kennesaw State" && year < 2022) return("FCS")
    if (t == "Jacksonville State" && year < 2022) return("FCS")
    return("C-USA")
  }
  # Historical C-USA members that left
  cusa_historical <- c("Tulane","East Carolina","Memphis","Houston","TCU","SMU",
                       "Marshall","Southern Miss","Texas State","North Texas","Old Dominion")
  if (t %in% cusa_historical && year <= 2012) return("C-USA")

  # ── MAC ───────────────────────────────────────────────────
  # Northern Illinois: MAC through 2025, Mountain West 2026+
  if (t == "Northern Illinois") {
    if (year >= 2026) return("Mountain West")
    return("MAC")
  }
  mac_stable <- c("Central Michigan","Eastern Michigan","Western Michigan",
                  "Ball State","Bowling Green","Buffalo","Kent State","Miami (OH)",
                  "Ohio","Toledo","Akron")
  if (t %in% mac_stable) {
    if (t == "Massachusetts" && year >= 2016) return("Independent")
    return("MAC")
  }

  # ── WAC (historical, pre-Mountain West consolidation) ─────
  wac_teams <- c("Hawai'i","Nevada","Utah State","Louisiana Tech","Fresno State",
                 "San Jose State","UTEP","New Mexico State","Idaho","Boise State")
  if (t %in% wac_teams && year <= 2011) return("WAC")

  # ── FCS schools that play FBS opponents ───────────────────
  # Delaware: FCS through 2024, C-USA 2025+
  if (t == "Delaware") {
    if (year >= 2025) return("C-USA")
    return("FCS")
  }
  # Missouri State: FCS (MVFC) through 2024, C-USA 2025+
  if (t == "Missouri State" || t == "Missouri St") {
    if (year >= 2025) return("C-USA")
    return("FCS")
  }

  # North Dakota State: FCS (MVFC) through 2025, Mountain West FBS 2026+
  if (t %in% c("North Dakota State","NDSU","N Dakota St")) {
    if (year >= 2026) return("Mountain West")
    return("FCS")
  }
  # Sacramento State: FCS (Big Sky) through 2025, MAC (football-only) 2026+
  if (t %in% c("Sacramento State","Sacramento St","Sac State","Sac. State")) {
    if (year >= 2026) return("MAC")
    return("FCS")
  }
  fcs_known <- c("App State","James Madison",
                 "Western Kentucky","Jacksonville State","Kennesaw State",
                 "Sam Houston","Georgia Southern","Coastal Carolina",
                 "Youngstown State","UNH","New Hampshire","Portland State",
                 "Villanova","Towson","Wofford","Furman","The Citadel",
                 "Northeastern","SF Austin","Stephen F. Austin",
                 "Maine","Montana State","Montana","Bethune","Bethune-Cookman",
                 "Cal Poly","Nicholls","Nicholls State","SE Louisiana",
                 "McNeese","Lamar","SC State","South Carolina State","Chattanooga",
                 "Elon","William & Mary","Samford","UT Martin","Austin Peay",
                 "North Dakota","South Dakota","N. Iowa","Northern Iowa",
                 "Albany","UAlbany","Rhode Island","New Hampshire","Yale","Harvard",
                 "Princeton","Dartmouth","Columbia","Cornell","Brown","Penn","Colgate",
                 "Fordham","Holy Cross","Bucknell","Georgetown","Lehigh","Lafayette",
                 "Liberty","Delaware State","Morgan State","Howard",
                 "Jackson State","Grambling","Prairie View","Southern",
                 "Florida A&M","Bethune-Cookman","Alabama State","Alabama A&M",
                 "Tennessee State","Tennessee Tech","Eastern Kentucky","Morehead State",
                 "Southeast Missouri","Murray State","Eastern Illinois","Jacksonville",
                 "Stetson","North Alabama","Lipscomb","North Florida")
  if (t %in% fcs_known) return("FCS")

  fcs_schools <- c(
    # Big South / CAA / MVFC / Big Sky / SoCon / OVC / ASUN / Patriot / etc.
    "North Dakota State","South Dakota State","Northern Iowa","South Dakota",
    "Montana State","Montana","Eastern Washington","Weber State","Sacramento State",
    "Northern Arizona","UC Davis","Idaho State","Northern Colorado","Portland State",
    "Southern Utah","Utah Tech","Cal Poly","UC Davis",
    # CAA
    "Delaware","Richmond","Villanova","Towson","Stony Brook","William & Mary",
    "Elon","Rhode Island","New Hampshire","Maine","Albany","Hofstra",
    "Charleston Southern","Coastal Carolina",
    # SoCon
    "Wofford","Furman","The Citadel","Western Carolina","Samford","Mercer",
    "Chattanooga","VMI","East Tennessee State",
    # OVC / ASUN
    "Eastern Kentucky","Southeast Missouri","Tennessee State","Tennessee Tech",
    "Murray State","UT Martin","Morehead State","Eastern Illinois","Lindenwood",
    "Jacksonville State","North Alabama","Tarleton State","Austin Peay",
    # Big South / CAA
    "Campbell","Gardner-Webb","Presbyterian","Sacred Heart","Monmouth",
    "Robert Morris","Saint Francis (PA)","Bryant","Wagner","Duquesne",
    "Central Connecticut State","Long Island University","Merrimack","Stony Brook",
    # SWAC / MEAC
    "Grambling","Prairie View A&M","Southern","Alcorn State","Jackson State",
    "Texas Southern","Alabama State","Alabama A&M","Florida A&M",
    "Bethune-Cookman","South Carolina State","Howard","Morgan State",
    "Delaware State","Norfolk State","North Carolina A&T","NC Central",
    "Savannah State","Mississippi Valley State","Arkansas-Pine Bluff",
    # Patriot
    "Colgate","Fordham","Holy Cross","Bucknell","Lafayette","Lehigh","Georgetown",
    # Ivy
    "Yale","Harvard","Princeton","Dartmouth","Columbia","Cornell","Brown","Penn",
    # Southland / WAC / Independents
    "Incarnate Word","Houston Christian","Abilene Christian","Nicholls",
    "SE Louisiana","McNeese","Lamar","Central Arkansas","Northwestern State",
    "Stephen F. Austin","Hampton","Drake","Central Connecticut State",
    "Western Illinois","Southern Illinois","Illinois State","Indiana State",
    "Missouri State","North Dakota","Northern Colorado","Idaho",
    # Big Sky
    "Montana","Montana State","Eastern Washington","Weber State",
    "Sacramento State","Northern Arizona","UC Davis","Idaho State",
    "Portland State","Southern Utah","Utah Tech","Northern Colorado",
    "Cal Poly",
    # Independent FCS
    "North Alabama","Tarleton State","East Texas A&M",
    # Generic catch — any team with very few FBS wins is likely FCS
    "Richmond","Elon","William & Mary","Hofstra",
    "Youngstown State","Villanova","Towson"
  )
  if (t %in% fcs_schools) return("FCS")

  return("FCS")  # default: unknown teams playing FBS are likely FCS
}

# ================================================================
# Conference assignment — auto-detected from ESPN's standings feed
# ================================================================
# ESPN regenerates its conference standings groupings every season, so
# reading them live means a team that changes conferences shows up
# correctly here automatically — no code edit needed when realignment
# happens. This is intentionally CFB-ONLY: a school's conference can
# (and does) differ by sport — e.g. a school can be a football
# independent while its basketball/baseball programs belong to a
# conference — so this map is built fresh from CFB's own endpoint here
# and is never shared with, or reused by, any other sport's script.
#
# Only used for the CURRENT season (see call site below) — historical
# seasons are already settled and stay on the static table above, so a
# parsing miss here can never corrupt past data, only skip the live
# shortcut for a team ESPN doesn't list, in which case it silently
# falls back to the static table (see get_conf() below).
fetch_cfb_conf_map <- function(season) {
  url <- paste0(
    "https://site.api.espn.com/apis/v2/sports/football/college-football/standings",
    "?season=", season, "&level=1"
  )
  data <- tryCatch(jsonlite::fromJSON(url, simplifyVector = FALSE), error = function(e) NULL)
  if (is.null(data)) return(character(0))

  # ESPN has used a couple of different shapes for this endpoint over
  # time — try each candidate path and use whichever one is populated.
  candidates <- list(data$children, data$standings$groups, data$groups)
  groups <- Find(function(g) length(g) > 0, candidates)
  if (is.null(groups)) return(character(0))

  out <- character(0)
  for (g in groups) {
    conf_name <- tryCatch(
      g$name %||% g$shortName %||% g$abbreviation, error = function(e) NULL
    )
    if (is.null(conf_name) || !nchar(conf_name)) next
    entries <- tryCatch(g$standings$entries, error = function(e) NULL)
    if (is.null(entries)) entries <- tryCatch(g$entries, error = function(e) NULL)
    if (is.null(entries)) next
    for (e in entries) {
      team_name <- tryCatch(
        e$team$shortDisplayName %||% e$team$displayName %||% e$team$name,
        error = function(e2) NULL
      )
      if (!is.null(team_name) && nchar(team_name) > 0) out[[team_name]] <- conf_name
    }
  }
  out
}

# ── Dispatcher: live lookup first, static table as fallback ────
get_conf <- function(team, year, live_map = NULL) {
  t <- trimws(team)
  if (t %in% names(ALIASES)) t <- ALIASES[[t]]
  if (!is.null(live_map) && t %in% names(live_map)) return(live_map[[t]])
  get_conf_static(t, year)
}

# ── Parse ESPN event ──────────────────────────────────────────
parse_event <- function(ev) {
  tryCatch({
    comp <- ev$competitions[[1]]
    if (!isTRUE(comp$status$type$completed)) return(NULL)
    comps <- comp$competitors
    if (length(comps) != 2) return(NULL)
    hi  <- which(sapply(comps, `[[`, "homeAway") == "home")
    ai  <- which(sapply(comps, `[[`, "homeAway") == "away")
    if (!length(hi)||!length(ai)) return(NULL)
    hs  <- suppressWarnings(as.numeric(comps[[hi]]$score))
    as_ <- suppressWarnings(as.numeric(comps[[ai]]$score))
    hn  <- comps[[hi]]$team$shortDisplayName
    an  <- comps[[ai]]$team$shortDisplayName
    if (is.na(hs)||is.na(as_)||is.null(hn)||is.null(an)||hs==as_) return(NULL)
    list(winner=if(hs>as_)hn else an, loser=if(hs>as_)an else hn,
         winner_pts=max(hs,as_), loser_pts=min(hs,as_))
  }, error=function(e) NULL)
}

# Known FBS Independents who might be missed by groups=80
FBS_INDEPENDENTS <- c("Notre Dame","Army","Navy","Massachusetts","UMass",
                      "Connecticut","UConn","BYU","Liberty","New Mexico State",
                      "North Alabama","Incarnate Word","East Texas A&M")

fetch_date <- function(ds) {
  resp <- tryCatch(
    GET("https://site.api.espn.com/apis/site/v2/sports/football/college-football/scoreboard",
        query=list(dates=ds, groups=80, limit=300), timeout(30)),
    error=function(e) NULL)
  if (is.null(resp)||status_code(resp)!=200) return(NULL)
  data <- tryCatch(fromJSON(rawToChar(resp$content),simplifyDataFrame=FALSE),
                   error=function(e) NULL)
  if (is.null(data)||length(data$events)==0) return(NULL)
  rows <- Filter(Negate(is.null), lapply(data$events, parse_event))
  if (!length(rows)) return(NULL)
  data.frame(winner=sapply(rows,`[[`,"winner"),loser=sapply(rows,`[[`,"loser"),
             winner_pts=as.numeric(sapply(rows,`[[`,"winner_pts")),
             loser_pts=as.numeric(sapply(rows,`[[`,"loser_pts")),
             stringsAsFactors=FALSE)
}

cfb_game_dates <- function(yr) {
  # Fetch EVERY calendar day — MAC plays Tue/Wed, Independents play anytime
  # ESPN dates=YYYYMMDD returns only that day's completed games → no duplicates
  all_dates <- c(
    seq(as.Date(paste0(yr,   "-08-24")), as.Date(paste0(yr,   "-12-10")), by="1 day"),
    seq(as.Date(paste0(yr,   "-12-15")), as.Date(paste0(yr+1, "-01-25")), by="1 day")
  )
  all_dates[all_dates <= Sys.Date()]
}

for (yr in SEASONS) {
  message("CFB ", yr, "...")
  dates <- cfb_game_dates(yr)
  all_games <- list()
  for (d in as.character(dates)) {
    res <- fetch_date(gsub("-","",d))
    if (!is.null(res)&&nrow(res)>0) {
      all_games <- c(all_games, list(res))
      Sys.sleep(0.15)  # polite delay only on game days
    } else {
      Sys.sleep(0.02)  # minimal delay on non-game days
    }
  }
  if (!length(all_games)) { message("  Skip"); next }

  g <- unique(do.call(rbind, all_games))
  g <- g[!is.na(g$winner)&g$winner!=""&g$winner!=g$loser,]

  # Filter out All-Star game teams, D2/NAIA teams, and other non-FBS/FCS entries
  FAKE_TEAMS <- c(
    # All-Star bowl teams
    "West","East","American","National","EAST","WEST",
    "Team 1","Team 2","Red","Blue","White",
    # D2 / NAIA / non-college
    "Wesley College","Chowan","Brevard","Kentucky Wesleyan","So Oregon",
    "West Chester","Shippensburg","Lenoir-Rhyne","Tusculum","West Georgia",
    "AR-Monticello","Missouri S&T","W Virginia Tech","Angelo St","Rhodes",
    "Winston-Salem","Clark Atlanta","Lincoln (MO)","St Francis (IL)",
    "St Francis (PA)","Ferris St","UNC Pembroke","So. Oregon"
  )
  # Also filter via alias resolution
  resolve_team <- function(t) {
    if (t %in% names(ALIASES)) ALIASES[[t]] else t
  }
  g <- g[!sapply(g$winner, resolve_team) %in% FAKE_TEAMS &
         !sapply(g$loser,  resolve_team) %in% FAKE_TEAMS, ]
  if (nrow(g) < 5) { message("  Skip — only ", nrow(g), " games"); next }
  message("  ", nrow(g), " games")

  # Current season only: publish the raw completed-games log too, so
  # R/update_cfb_playoff.R (Playoff Chance Monte Carlo sim) has real
  # head-to-head / common-opponent results to work from instead of just
  # aggregate W-L — it runs as a separate script right after this one
  # and reads this file back in.
  if (yr == CURRENT_YEAR) {
    write_csv(g, file.path(OUT_DIR, paste0("CFB_Games_", yr, ".csv")))
  }

  elo <- run_elo(g, k=30, iters=10, min_games=4)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)

  # Only hit the live conference endpoint for the current/upcoming season —
  # historical seasons are already settled and stay on the static table,
  # so a bad parse here can never touch past data.
  live_conf_map <- if (yr >= CURRENT_YEAR) fetch_cfb_conf_map(yr) else character(0)
  message("  Live conference map (", yr, "): ", length(live_conf_map), " teams",
          if (yr >= CURRENT_YEAR && !length(live_conf_map)) " — falling back to static table" else "")

  conf_vec <- setNames(sapply(elo$team, function(t) get_conf(t, yr, live_conf_map)), elo$team)
  out <- build_output(elo, season=yr, conf_map=conf_vec, sos_map=sos)

  elo_lup <- setNames(elo$elo, elo$team)
  # Quality threshold: only credit wins vs opponents above 1350 Elo
  # Prevents cupcake wins from inflating resume score
  resume  <- tapply(seq_len(nrow(g)), g$winner,
                    function(rows) sum(pmax(0, elo_lup[g$loser[rows]] - 1350), na.rm=TRUE))
  # BUG FIX: tapply() only produces an entry for teams that appear as a
  # winner at least once — a team with zero wins this season is simply
  # absent from `resume`, and indexing a named vector by a name it doesn't
  # have returns NA (not 0). That NA then poisoned out$pr below (elo * ... +
  # sqrt(NA) = NA), so EVERY still-winless team got pr = NA in the CSV —
  # which, written out as JSON `null` further downstream, crashed the CFB
  # Playoff Chance render entirely (t.pr.toFixed() on null throws), silently
  # falling back to the classic Resume table with no visible error. A team
  # with no wins has no resume bonus, which is 0, not "unknown" — same
  # intent as the pmax(0, ...) floor already used everywhere else here.
  out$resume_score <- round(ifelse(is.na(resume[out$team]), 0, resume[out$team]), 1)
  # PR = Elo × win_pct^0.6 + √(quality_resume)
  # win_pct^0.6 penalizes losing records (7-5 SEC team drops significantly)
  out$pr <- round(
    out$elo * (pmax(0.01, out$win_pct) ^ 0.6) +
    sqrt(pmax(0, out$resume_score)),
    1
  )
  out <- as.data.frame(lapply(out, function(x) {
    if(is.list(x)) sapply(x, function(v) if(is.null(v)) NA else as.character(v))
    else x
  }), stringsAsFactors=FALSE)

  out_path <- file.path(OUT_DIR, paste0("CFB_Elo_", yr, ".csv"))
  out <- attach_movers(out, out_path)

  write_csv(out, out_path)
  covered <- sum(!is.na(out$conference) & out$games_played >= 5)
  total5  <- sum(out$games_played >= 5)
  message("  -> ", nrow(out), " teams | conf (5+ gp): ", covered, "/", total5)
}
message("CFB done.")
