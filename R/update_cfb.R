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
SEASONS <- 2001:CURRENT_YEAR
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

# ── Alias map: every ESPN variant → canonical team name ────────
# Add new variants here; the conference logic below stays clean.
ALIASES <- c(
  # Florida State
  "Florida State"="Florida St","Fla. State"="Florida St","Fla St"="Florida St","FSU"="Florida St",
  # NC State
  "N.C. State"="NC State","North Carolina St"="NC State","N Carolina St"="NC State","NC St"="NC State",
  # North Carolina
  "N. Carolina"="North Carolina","UNC"="North Carolina","No. Carolina"="North Carolina",
  # Virginia
  "UVA"="Virginia","Va."="Virginia",
  # Virginia Tech
  "Va. Tech"="Virginia Tech","VaTech"="Virginia Tech","VT"="Virginia Tech",
  # Georgia Tech
  "Ga. Tech"="Georgia Tech","GT"="Georgia Tech",
  # Boston College
  "BC"="Boston College","Boston Col"="Boston College",
  # Pittsburgh
  "Pitt"="Pittsburgh",
  # Miami
  "Miami (FL)"="Miami","Miami FL"="Miami",
  # Ohio State
  "Ohio St"="Ohio State","Ohio St."="Ohio State",
  # Penn State
  "Penn St"="Penn State","Penn St."="Penn State",
  # Michigan State
  "Michigan St"="Michigan State","Michigan St."="Michigan State",
  # Oklahoma State
  "Oklahoma St"="Oklahoma State","Oklahoma St."="Oklahoma State","Okla. State"="Oklahoma State","Okla St"="Oklahoma State",
  # Iowa State
  "Iowa St"="Iowa State","Iowa St."="Iowa State",
  # Kansas State
  "Kansas St"="Kansas State","Kansas St."="Kansas State","K-State"="Kansas State","Kan. State"="Kansas State",
  # West Virginia
  "W. Virginia"="West Virginia","W Virginia"="West Virginia","WVU"="West Virginia","W. Va."="West Virginia",
  # Texas A&M
  "Texas A&M Aggies"="Texas A&M","TA&M"="Texas A&M",
  # Mississippi State
  "Mississippi St"="Miss St","Mississippi St."="Miss St","Miss State"="Miss St","Miss. State"="Miss St",
  "Miss. St."="Miss St","Mississippi State"="Miss St",
  # Ole Miss
  "Mississippi"="Ole Miss","Mississippi Rebels"="Ole Miss",
  # South Carolina
  "S. Carolina"="South Carolina","S Carolina"="South Carolina",
  # Oregon State
  "Oregon St"="Oregon State","Oregon St."="Oregon State",
  # Washington State
  "Washington St"="Washington State","Washington St."="Washington State",
  "Wash. State"="Washington State","Wash St"="Washington State",
  # Arizona State
  "Arizona St"="Arizona State","Arizona St."="Arizona State","Ariz. State"="Arizona State","Ariz St"="Arizona State",
  # California
  "Cal"="California","UC Berkeley"="California","California Bears"="California",
  # Boise State
  "Boise St"="Boise State","Boise St."="Boise State",
  # Colorado State
  "Colorado St"="Colorado State","Colorado St."="Colorado State","Colo. State"="Colorado State","Colo St"="Colorado State",
  # Fresno State
  "Fresno St"="Fresno State","Fresno St."="Fresno State",
  # Utah State
  "Utah St"="Utah State","Utah St."="Utah State",
  # San Jose State
  "San Jose St"="San Jose State","San José St"="San Jose State","San Jose St."="San Jose State","SJSU"="San Jose State",
  "San José State"="San Jose State",
  # San Diego State
  "San Diego St"="San Diego State","San Diego St."="San Diego State","SDSU"="San Diego State",
  # Hawai'i
  "Hawaii"="Hawai'i","Haw."="Hawai'i",
  # UNLV
  "Nevada-Las Vegas"="UNLV",
  # New Mexico
  "N. Mexico"="New Mexico","NM"="New Mexico",
  # South Florida
  "S. Florida"="South Florida","South Fla"="South Florida","South Fla."="South Florida",
  "USF"="South Florida","S Fla"="South Florida","South Fla."="South Florida",
  # East Carolina
  "E. Carolina"="East Carolina","ECU"="East Carolina","E Carolina"="East Carolina",
  "E. Car."="East Carolina",
  # UConn
  "Connecticut"="UConn","Conn."="UConn",
  # UCF
  "Central Florida"="UCF","Cent. Florida"="UCF",
  # SMU
  "Southern Methodist"="SMU",
  # Louisiana (UL Lafayette)
  "Louisiana Lafayette"="Louisiana","UL Lafayette"="Louisiana","ULL"="Louisiana",
  "Louisiana-Lafayette"="Louisiana","UL"="Louisiana",
  # UL Monroe
  "Louisiana Monroe"="UL Monroe","Louisiana-Monroe"="UL Monroe","La.-Monroe"="UL Monroe","ULM"="UL Monroe",
  # Appalachian State
  "Appalachian St"="App State","Appalachian State"="App State","App St"="App State","Appy State"="App State",
  # Arkansas State
  "Arkansas St"="Arkansas State","Arkansas St."="Arkansas State","Ark. State"="Arkansas State","Ark St"="Arkansas State",
  # Georgia Southern
  "Ga. Southern"="Georgia Southern","Ga Southern"="Georgia Southern",
  "GA Southern"="Georgia Southern","Georgia So"="Georgia Southern",
  # Georgia State
  "Ga. State"="Georgia State","Ga State"="Georgia State","GA State"="Georgia State",
  "GA St"="Georgia State","Ga St"="Georgia State",
  # South Alabama
  "S. Alabama"="South Alabama","S Alabama"="South Alabama",
  "South Ala"="South Alabama","South Ala."="South Alabama","South Ala"="South Alabama",
  # Texas State
  "Texas St"="Texas State","Texas St."="Texas State","Tex. State"="Texas State","Tex St"="Texas State",
  # Coastal Carolina
  "Coastal Car"="Coastal Carolina","Coast. Carolina"="Coastal Carolina","Coastal Car."="Coastal Carolina",
  # Southern Miss
  "Southern Mississippi"="Southern Miss","S. Mississippi"="Southern Miss","Southern Miss."="Southern Miss",
  # Old Dominion
  "Old Dom."="Old Dominion","ODU"="Old Dominion",
  # James Madison
  "JMU"="James Madison","James Mad."="James Madison",
  # Middle Tennessee
  "Middle Tenn"="Middle Tennessee","Middle Tenn."="Middle Tennessee",
  "MTSU"="Middle Tennessee","Mid Tenn"="Middle Tennessee","Mid Tennessee"="Middle Tennessee",
  # Western Kentucky
  "Western Ky"="Western Kentucky","Western Ky."="Western Kentucky",
  "W. Kentucky"="Western Kentucky","WKU"="Western Kentucky","W Kentucky"="Western Kentucky",
  # Florida Atlantic
  "Fla. Atlantic"="Florida Atlantic","FAU"="Florida Atlantic",
  "Fla Atlantic"="Florida Atlantic","Fla. Atl."="Florida Atlantic",
  # FIU
  "Florida International"="FIU","Fla. International"="FIU",
  # Louisiana Tech
  "La. Tech"="Louisiana Tech","La Tech"="Louisiana Tech","Louisiana Tech."="Louisiana Tech",
  # New Mexico State
  "New Mexico St"="New Mexico State","New Mexico St."="New Mexico State",
  "NMSU"="New Mexico State","NM State"="New Mexico State",
  # Jacksonville State
  "Jacksonville St"="Jacksonville State","Jacksonville St."="Jacksonville State",
  "Jax State"="Jacksonville State","Jax St"="Jacksonville State",
  # Kennesaw State
  "Kennesaw St"="Kennesaw State","KSU"="Kennesaw State","Kennesaw St."="Kennesaw State",
  # Sam Houston
  "Sam Houston State"="Sam Houston","Sam Houston St"="Sam Houston","SHSU"="Sam Houston",
  # Central Michigan
  "Cent. Michigan"="Central Michigan","C. Michigan"="Central Michigan",
  "Central Mich"="Central Michigan","Central Mich."="Central Michigan",
  "Cent Michigan"="Central Michigan","CMU"="Central Michigan",
  # Eastern Michigan
  "E. Michigan"="Eastern Michigan","E Michigan"="Eastern Michigan",
  "Eastern Mich"="Eastern Michigan","Eastern Mich."="Eastern Michigan","EMU"="Eastern Michigan",
  # Western Michigan
  "W. Michigan"="Western Michigan","W Michigan"="Western Michigan",
  "Western Mich"="Western Michigan","Western Mich."="Western Michigan","WMU"="Western Michigan",
  # Northern Illinois
  "N. Illinois"="Northern Illinois","N Illinois"="Northern Illinois",
  "Northern Ill"="Northern Illinois","Northern Ill."="Northern Illinois",
  "NIU"="Northern Illinois","No. Illinois"="Northern Illinois",
  # Ball State
  "Ball St"="Ball State","Ball St."="Ball State",
  # Bowling Green
  "Bowling Green St"="Bowling Green","BGSU"="Bowling Green","Bowl. Green"="Bowling Green",
  # Buffalo
  "UB"="Buffalo",
  # Kent State
  "Kent St"="Kent State","Kent St."="Kent State",
  # Miami (OH)
  "Miami OH"="Miami (OH)","Miami (Ohio)"="Miami (OH)","MiamiOH"="Miami (OH)",
  # Massachusetts
  "UMass"="Massachusetts","Mass."="Massachusetts",
  # Tulsa
  "Golden Hurricane"="Tulsa",
  # Troy State historical
  "Troy State"="Troy","Troy St"="Troy",
  # Navy
  "Navy Midshipmen"="Navy",
  # Temple
  "Owls"="Temple",
  # Charlotte
  "UNCC"="Charlotte",
  # UAB
  "Alabama-Birmingham"="UAB",
  # UTSA
  "UT San Antonio"="UTSA",
  # UTEP
  "Texas-El Paso"="UTEP","UT El Paso"="UTEP",
  # Rice
  "Rice Owls"="Rice",
  # Louisiana Monroe name changes
  "Northeastern Louisiana"="UL Monroe","NE Louisiana"="UL Monroe",
  # Historical name changes
  "Southwest Texas St"="Texas State","Southwest Texas"="Texas State",
  "Indiana State"="Indiana",  # disambiguation: Indiana the B1G school
  # BYU
  "Brigham Young"="BYU",
  # Notre Dame variants
  "Notre Dame Fighting Irish"="Notre Dame","ND"="Notre Dame"
)

# ── Canonical conference map ────────────────────────────────────
# Uses canonical names only (after alias resolution).
# Year-aware via function logic below.
get_conf <- function(team, year) {
  t <- trimws(team)

  # Step 1: Resolve alias to canonical name
  if (t %in% names(ALIASES)) t <- ALIASES[[t]]

  # Step 2: Look up by canonical name with year logic

  # ── Permanent independents ─────────────────────────────────
  if (t == "Notre Dame") return("Independent")
  if (t == "Army")       return("Independent")
  if (t == "Navy") {
    if (year >= 2015 && year <= 2023) return("AAC")
    return("Independent")
  }
  if (t == "BYU") {
    if (year <= 2010) return("Mountain West")
    if (year <= 2022) return("Independent")
    return("Big 12")
  }
  if (t == "Massachusetts") {
    if (year >= 2012) return("Independent")
    return(NA_character_)
  }
  if (t == "UConn") {
    if (year >= 2020) return("Independent")
    if (year >= 2013) return("AAC")
    return("Big East")
  }
  if (t == "Liberty") {
    if (year >= 2023) return("C-USA")
    if (year >= 2018) return("Independent")
    return(NA_character_)
  }
  if (t == "New Mexico State") {
    if (year >= 2023) return("C-USA")
    if (year >= 2018) return("Independent")
    return("WAC")
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
                  "Iowa","Purdue","Illinois","Indiana","Northwestern","Nebraska")
  if (t %in% b10_stable) return("Big Ten")
  if (t == "Maryland"  && year >= 2014) return("Big Ten")
  if (t == "Rutgers") {
    if (year >= 2014) return("Big Ten")
    return("Big East")
  }
  if (t %in% c("UCLA","USC")       && year >= 2024) return("Big Ten")
  if (t == "Washington"            && year >= 2024) return("Big Ten")
  if (t == "Oregon"                && year >= 2024) return("Big Ten")

  # ── BIG 12 ────────────────────────────────────────────────
  b12_stable <- c("Kansas","Kansas State","Iowa State","Baylor","TCU","Texas Tech","Oklahoma State")
  if (t %in% b12_stable) return("Big 12")
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
  mw_stable <- c("Boise State","San Diego State","Fresno State","Utah State","UNLV",
                 "Wyoming","Nevada","New Mexico","Air Force","Colorado State",
                 "San Jose State","Hawai'i")
  if (t %in% mw_stable) return("Mountain West")
  if (t == "Utah"     && year <= 2010) return("Mountain West")
  if (t == "BYU"      && year <= 2010) return("Mountain West")
  if (t == "TCU"      && year <= 2011) return("Mountain West")
  if (t == "Colorado" && year <= 2010) return("Mountain West")

  # ── AAC (2013+) / BIG EAST football (2001-2012) ───────────
  aac_founding <- c("South Florida","East Carolina","Memphis","Tulane","Temple",
                    "Houston","UCF","Cincinnati","Tulsa","Navy","Wichita State","SMU")
  big_east_fb  <- c("South Florida","Rutgers","Pittsburgh","Cincinnati","West Virginia",
                    "Louisville","Syracuse","UConn","Navy","Temple")
  if (t %in% big_east_fb && year <= 2012) return("Big East")
  if (t %in% aac_founding) {
    if (year >= 2013) return("AAC")
    return("Big East")
  }
  if (t == "North Texas") {
    if (year >= 2024) return("AAC")
    if (year >= 2013) return("C-USA")
    return("Sun Belt")
  }
  if (t == "Charlotte"   && year >= 2015 && year <= 2023) return("C-USA")
  if (t == "UTSA"        && year >= 2013) return("C-USA")

  # ── SUN BELT ──────────────────────────────────────────────
  sunbelt_stable <- c("Louisiana","Troy","App State","Arkansas State","Georgia Southern",
                      "Georgia State","South Alabama","UL Monroe","Southern Miss",
                      "Texas State","Coastal Carolina","Old Dominion","James Madison",
                      "Marshall")
  if (t %in% sunbelt_stable) {
    if (t == "Marshall") {
      if (year >= 2022) return("Sun Belt")
      if (year >= 2005) return("C-USA")
      return("MAC")
    }
    if (t == "Old Dominion") {
      if (year >= 2022) return("Sun Belt")
      if (year >= 2014) return("C-USA")
      return(NA_character_)
    }
    if (t == "App State") {
      if (year >= 2014) return("Sun Belt")
      return("FCS")
    }
    if (t == "James Madison") {
      if (year >= 2023) return("Sun Belt")
      return("FCS")
    }
    if (t == "South Alabama" && year < 2012) return(NA_character_)
    if (t == "Georgia State" && year < 2013) return(NA_character_)
    if (t == "Coastal Carolina" && year < 2017) return("FCS")
    if (t %in% c("Southern Miss","Texas State") && year <= 2012) return("C-USA")
    return("Sun Belt")
  }

  # ── C-USA ─────────────────────────────────────────────────
  cusa_current <- c("UAB","Middle Tennessee","Western Kentucky","Florida Atlantic","FIU",
                    "UTEP","Louisiana Tech","Rice","Kennesaw State","Jacksonville State",
                    "Sam Houston","Liberty","New Mexico State","UTSA","Charlotte")
  if (t %in% cusa_current) {
    if (t == "Middle Tennessee" && year <= 2012) return("Sun Belt")
    if (t == "Western Kentucky" && year < 2009)  return("FCS")
    if (t == "FAU"  && year < 2001) return(NA_character_)
    if (t == "FIU"  && year < 2009) return(NA_character_)
    if (t == "UTSA" && year < 2013) return(NA_character_)
    if (t == "Kennesaw State" && year < 2022) return(NA_character_)
    if (t == "Jacksonville State" && year < 2022) return("FCS")
    return("C-USA")
  }
  # Historical C-USA members that left
  cusa_historical <- c("Tulane","East Carolina","Memphis","Houston","TCU","SMU",
                       "Marshall","Southern Miss","Texas State","North Texas","Old Dominion")
  if (t %in% cusa_historical && year <= 2012) return("C-USA")

  # ── MAC ───────────────────────────────────────────────────
  mac_stable <- c("Central Michigan","Eastern Michigan","Western Michigan","Northern Illinois",
                  "Ball State","Bowling Green","Buffalo","Kent State","Miami (OH)",
                  "Ohio","Toledo","Akron","Massachusetts")
  if (t %in% mac_stable) {
    if (t == "Massachusetts" && year >= 2016) return("Independent")
    return("MAC")
  }

  # ── WAC (historical, pre-Mountain West consolidation) ─────
  wac_teams <- c("Hawai'i","Nevada","Utah State","Louisiana Tech","Fresno State",
                 "San Jose State","UTEP","New Mexico State","Idaho","Boise State")
  if (t %in% wac_teams && year <= 2011) return("WAC")

  # ── FCS schools that play FBS opponents ───────────────────
  fcs_known <- c("App State","James Madison","North Dakota State","NDSU",
                 "Western Kentucky","Jacksonville State","Kennesaw State",
                 "Sam Houston","Georgia Southern","Coastal Carolina",
                 "Youngstown State","UNH","New Hampshire","Portland State",
                 "Villanova","Towson","Wofford","Furman","The Citadel","Delaware",
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

  return(NA_character_)
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
  all_dates <- c(
    seq(as.Date(paste0(yr,  "-08-24")), as.Date(paste0(yr,  "-12-07")), by="1 day"),
    seq(as.Date(paste0(yr,  "-12-15")), as.Date(paste0(yr+1,"-01-22")), by="1 day")
  )
  all_dates  <- all_dates[all_dates <= Sys.Date()]
  in_bowl    <- all_dates >= as.Date(paste0(yr,"-12-15"))
  all_dates[weekdays(all_dates) %in% c("Thursday","Friday","Saturday") | in_bowl]
}

for (yr in SEASONS) {
  message("CFB ", yr, "...")
  dates <- cfb_game_dates(yr)
  all_games <- list()
  for (d in as.character(dates)) {
    res <- fetch_date(gsub("-","",d))
    if (!is.null(res)&&nrow(res)>0) all_games <- c(all_games, list(res))
    Sys.sleep(0.2)
  }
  if (!length(all_games)) { message("  Skip"); next }

  g <- unique(do.call(rbind, all_games))
  g <- g[!is.na(g$winner)&g$winner!=""&g$winner!=g$loser,]
  if (nrow(g) < 50) { message("  Skip — only ", nrow(g), " games"); next }
  message("  ", nrow(g), " games")

  elo <- run_elo(g, k=30, iters=10, min_games=4)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)
  conf_vec <- setNames(sapply(elo$team, function(t) get_conf(t, yr)), elo$team)
  out <- build_output(elo, season=yr, conf_map=conf_vec, sos_map=sos)

  elo_lup <- setNames(elo$elo, elo$team)
  resume  <- tapply(seq_len(nrow(g)), g$winner,
                    function(rows) sum(elo_lup[g$loser[rows]], na.rm=TRUE))
  out$resume_score <- round(resume[out$team], 1)
  out <- as.data.frame(lapply(out, function(x) {
    if(is.list(x)) sapply(x, function(v) if(is.null(v)) NA else as.character(v))
    else x
  }), stringsAsFactors=FALSE)

  write_csv(out, file.path(OUT_DIR, paste0("CFB_Elo_", yr, ".csv")))
  covered <- sum(!is.na(out$conference) & out$games_played >= 5)
  total5  <- sum(out$games_played >= 5)
  message("  -> ", nrow(out), " teams | conf (5+ gp): ", covered, "/", total5)
}
message("CFB done.")
