# ================================================================
# R/update_college_baseball.R  —  NCAA D1 Baseball, 2018–current
# Data: ESPN scoreboard API
#
# Key fixes in this version:
#  1. Daily fetching (not weekly batches) to avoid gaps/duplicates
#  2. limit=1000 per request
#  3. groups=11 for college baseball
#  4. Comprehensive conference map
#  5. Future season guard
# ================================================================
suppressPackageStartupMessages({
  library(dplyr); library(readr); library(httr); library(jsonlite)
})
source("R/elo_engine.R")

CURRENT_YEAR <- as.integer(format(Sys.Date(), "%Y"))
SEASONS <- 2018:(CURRENT_YEAR + 1L)
OUT_DIR  <- "docs/CollegeBaseball/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

# ================================================================
# Conference map for college baseball
# ================================================================
get_conf_cbase <- function(team, year) {
  t <- trimws(team)

  # Short name aliases
  ALIASES <- c(
    "Miss St"="Mississippi State","Miss. State"="Mississippi State",
    "Miss. St."="Mississippi State","Mississippi St"="Mississippi State",
    "Ole Miss"="Ole Miss",
    "Oregon St"="Oregon State","Ore. State"="Oregon State",
    "Arizona St"="Arizona State","Ariz. St."="Arizona State",
    "Fla. State"="Florida State","Florida St"="Florida State","FSU"="Florida State",
    "NC State"="NC State","N.C. State"="NC State","N Carolina St"="NC State",
    "North Carolina St"="NC State",
    "Georgia Tech"="Georgia Tech","Ga. Tech"="Georgia Tech","GT"="Georgia Tech",
    "Boston College"="Boston College","BC"="Boston College",
    "Virginia Tech"="Virginia Tech","Va. Tech"="Virginia Tech","VT"="Virginia Tech",
    "Pittsburgh"="Pittsburgh","Pitt"="Pittsburgh",
    "Notre Dame"="Notre Dame","ND"="Notre Dame",
    "UNC"="North Carolina","N. Carolina"="North Carolina",
    "UVA"="Virginia","Va."="Virginia",
    "Miami"="Miami","Miami (FL)"="Miami",
    "Ohio St"="Ohio State","Ohio St."="Ohio State",
    "Penn St"="Penn State","Penn St."="Penn State",
    "Michigan St"="Michigan State","Michigan St."="Michigan State",
    "Oklahoma St"="Oklahoma State","Okla. State"="Oklahoma State",
    "Iowa St"="Iowa State","Iowa St."="Iowa State",
    "Kansas St"="Kansas State","Kansas St."="Kansas State","K-State"="Kansas State",
    "Texas Tech"="Texas Tech",
    "TCU"="TCU","Texas Christian"="TCU",
    "West Virginia"="West Virginia","WVU"="West Virginia","W. Virginia"="West Virginia",
    "Washington St"="Washington State","Wash. State"="Washington State",
    "Wash St"="Washington State",
    "Cal"="California","UC Berkeley"="California",
    "Fresno St"="Fresno State","Fresno St."="Fresno State",
    "Utah St"="Utah State","Utah St."="Utah State",
    "San Jose St"="San Jose State","San José St"="San Jose State","SJSU"="San Jose State",
    "San Diego St"="San Diego State","SDSU"="San Diego State",
    "Hawaii"="Hawai'i","Hawai'i"="Hawai'i",
    "Boise St"="Boise State","Boise St."="Boise State",
    "Colorado St"="Colorado State","Colo. State"="Colorado State",
    "UNLV"="UNLV",
    "USF"="South Florida","South Fla"="South Florida","South Fla."="South Florida",
    "ECU"="East Carolina","E. Carolina"="East Carolina","E Carolina"="East Carolina",
    "Jax State"="Jacksonville State","Jacksonville St"="Jacksonville State",
    "Jax St"="Jacksonville State",
    "Kennesaw St"="Kennesaw State","Kenn. State"="Kennesaw State",
    "App State"="Appalachian State","Appalachian St"="Appalachian State",
    "Ga. Southern"="Georgia Southern","Ga Southern"="Georgia Southern",
    "GA Southern"="Georgia Southern","Georgia So"="Georgia Southern",
    "Ga. State"="Georgia State","GA St"="Georgia State","Ga St"="Georgia State",
    "Ark State"="Arkansas State","Ark St"="Arkansas State","Arkansas St"="Arkansas State",
    "Tex State"="Texas State","Texas St"="Texas State","Tex St"="Texas State",
    "Coastal Car"="Coastal Carolina","Coastal"="Coastal Carolina",
    "S. Alabama"="South Alabama","South Ala"="South Alabama",
    "Old Dom."="Old Dominion","ODU"="Old Dominion",
    "Southern Miss"="Southern Miss","So. Miss"="Southern Miss",
    "UL Monroe"="UL Monroe","La.-Monroe"="UL Monroe","ULM"="UL Monroe",
    "Louisiana Lafayette"="Louisiana","UL Lafayette"="Louisiana","ULL"="Louisiana",
    "Western Ky"="Western Kentucky","Western Ky."="Western Kentucky","WKU"="Western Kentucky",
    "W. Kentucky"="Western Kentucky","W Kentucky"="Western Kentucky",
    "Middle Tenn"="Middle Tennessee","Middle Tenn."="Middle Tennessee","MTSU"="Middle Tennessee",
    "Fla. Atlantic"="Florida Atlantic","FAU"="Florida Atlantic",
    "FIU Panthers"="FIU","Florida Intl"="FIU","Fla. Intl"="FIU",
    "La. Tech"="Louisiana Tech","La Tech"="Louisiana Tech",
    "New Mexico St"="New Mexico State","New Mexico St."="New Mexico State","NMSU"="New Mexico State",
    "Sam Hous."="Sam Houston","Sam Houston St"="Sam Houston","SHSU"="Sam Houston",
    "Dallas Baptist"="Dallas Baptist","DBU"="Dallas Baptist",
    "CA Baptist"="Cal Baptist","Cal Baptist"="Cal Baptist",
    "ETSU"="East Tennessee State","E. Tenn. State"="East Tennessee State",
    "McNeese St"="McNeese","McNeese State"="McNeese",
    "SE Louisiana"="SE Louisiana","Southeastern"="SE Louisiana",
    "SE Missouri St"="Southeast Missouri",
    "Nicholls St"="Nicholls","Nicholls State"="Nicholls",
    "Campbell"="Campbell","Campbells"="Campbell",
    "Winthrop"="Winthrop","High Point"="High Point",
    "Gardner-Webb"="Gardner-Webb",
    "Merrimack"="Merrimack",
    "Charleston So"="Charleston Southern","Ch. Southern"="Charleston Southern",
    "N'Western St"="Northwestern State","Northwestern St"="Northwestern State",
    "Lamar"="Lamar",
    "Houston Baptist"="Houston Christian","Hou Christian"="Houston Christian",
    "Hou. Christian"="Houston Christian","Houston Baptist"="Houston Christian",
    "Abil Christian"="Abilene Christian","Abilene Chrstn"="Abilene Christian",
    "SFA"="Stephen F. Austin","SF Austin"="Stephen F. Austin",
    "Tarleton St"="Tarleton State",
    "GCU"="Grand Canyon","Grand Canyon"="Grand Canyon",
    "Cal Poly"="Cal Poly","SLO"="Cal Poly",
    "UC Santa Barbara"="UC Santa Barbara","UCSB"="UC Santa Barbara",
    "Santa Barbara"="UC Santa Barbara",
    "UC Irvine"="UC Irvine","UCI"="UC Irvine",
    "Long Beach St"="Long Beach State","LBSU"="Long Beach State",
    "CS Fullerton"="Cal State Fullerton","Fullerton"="Cal State Fullerton",
    "Sacramento St"="Sacramento State","Sac. State"="Sacramento State",
    "CS Northridge"="Cal State Northridge","CSUN"="Cal State Northridge",
    "UC Davis"="UC Davis","UC Riverside"="UC Riverside","UC San Diego"="UC San Diego",
    "Gonzaga"="Gonzaga",
    "BYU"="BYU","Brigham Young"="BYU",
    "St. Mary's"="Saint Mary's","Saint Mary's"="Saint Mary's",
    "Pepperdine"="Pepperdine","Loyola Marymount"="Loyola Marymount","LMU"="Loyola Marymount",
    "San Francisco"="San Francisco","USF"="South Florida",
    "Indiana St"="Indiana State","Indiana St."="Indiana State",
    "Illinois St"="Illinois State","Illinois St."="Illinois State",
    "S. Illinois"="Southern Illinois","S Illinois"="Southern Illinois",
    "Missouri St"="Missouri State","Mo. State"="Missouri State",
    "Wright St"="Wright State","Wright St."="Wright State",
    "N. Kentucky"="Northern Kentucky","N Kentucky"="Northern Kentucky",
    "Oakland"="Oakland","Purdue FW"="Purdue Fort Wayne",
    "IU Indy"="IU Indianapolis","IUPUI"="IU Indianapolis",
    "Milwaukee"="Milwaukee","Green Bay"="Green Bay",
    "Morehead St"="Morehead State","Morehead St."="Morehead State",
    "E. Kentucky"="Eastern Kentucky","E Kentucky"="Eastern Kentucky",
    "Murray St"="Murray State","Murray St."="Murray State",
    "UT Martin"="UT Martin","UTM"="UT Martin",
    "Bellarmine"="Bellarmine",
    "Lipscomb"="Lipscomb","North Alabama"="North Alabama",
    "North Florida"="North Florida","Queens"="Queens",
    "Stetson"="Stetson","Jacksonville"="Jacksonville",
    "FGCU"="Florida Gulf Coast","Florida Gulf Coast"="Florida Gulf Coast",
    "Belmont"="Belmont","Evansville"="Evansville",
    "N. Iowa"="Northern Iowa","Northern Iowa"="Northern Iowa","UNI"="Northern Iowa",
    "Valparaiso"="Valparaiso","Bradley"="Bradley",
    "NC A&T"="North Carolina A&T","N.C. A&T"="North Carolina A&T",
    "Delaware St"="Delaware State","Norfolk St"="Norfolk State",
    "Morgan St"="Morgan State","Coppin St"="Coppin State",
    "MD East. Shore"="Maryland Eastern Shore",
    "Alcorn St"="Alcorn State","Jackson St"="Jackson State",
    "Grambling"="Grambling","Prairie View"="Prairie View A&M",
    "Alabama A&M"="Alabama A&M","Alabama St"="Alabama State",
    "Bethune"="Bethune-Cookman","Fla. A&M"="Florida A&M",
    "SC State"="South Carolina State","Southern"="Southern",
    "Miss Valley St"="Mississippi Valley State",
    "AR-Pine Bluff"="Arkansas-Pine Bluff",
    "TX Southern"="Texas Southern","Texas Southern"="Texas Southern",
    "Savannah St"="Savannah State",
    "NC Central"="NC Central","N.C. Central"="NC Central",
    "Howard"="Howard","Coppin"="Coppin State",
    "VMI"="VMI","Citadel"="The Citadel","The Citadel"="The Citadel",
    "Furman"="Furman","Wofford"="Wofford","Samford"="Samford",
    "Mercer"="Mercer","W. Carolina"="Western Carolina","W Carolina"="Western Carolina",
    "Chattanooga"="Chattanooga","UTC"="Chattanooga",
    "UNC Greens."="UNC Greensboro","UNC Greensboro"="UNC Greensboro",
    "Elon"="Elon",
    "Colgate"="Colgate","Fordham"="Fordham","Holy Cross"="Holy Cross",
    "Bucknell"="Bucknell","Lafayette"="Lafayette","Lehigh"="Lehigh",
    "Army"="Army","Navy"="Navy","Air Force"="Air Force",
    "Yale"="Yale","Harvard"="Harvard","Princeton"="Princeton",
    "Dartmouth"="Dartmouth","Columbia"="Columbia","Cornell"="Cornell",
    "Brown"="Brown","Penn"="Penn",
    "Long Island"="Long Island University","LIU"="Long Island University",
    "Wagner"="Wagner","Rider"="Rider","Bryant"="Bryant",
    "Sacred Heart"="Sacred Heart","Fairfield"="Fairfield",
    "Monmouth"="Monmouth","Marist"="Marist","Manhattan"="Manhattan",
    "Canisius"="Canisius","Niagara"="Niagara","Siena"="Siena",
    "Quinnipiac"="Quinnipiac","UAlbany"="Albany","Albany"="Albany",
    "Binghamton"="Binghamton","Stony Brook"="Stony Brook",
    "Maine"="Maine","UMBC"="UMBC","Maryland"="Maryland",
    "Rutgers"="Rutgers","Seton Hall"="Seton Hall","St. John's"="St. John's",
    "Georgetown"="Georgetown","Providence"="Providence","Creighton"="Creighton",
    "Xavier"="Xavier","DePaul"="DePaul","Villanova"="Villanova",
    "Butler"="Butler","Marquette"="Marquette","UConn"="UConn",
    "Connecticut"="UConn"
  )

  if (t %in% names(ALIASES)) t <- ALIASES[[t]]

  # ── Power conferences ──────────────────────────────────────
  acc <- c("Clemson","Miami","NC State","Duke","Virginia","Virginia Tech",
           "Georgia Tech","Wake Forest","Louisville","Pittsburgh","Syracuse",
           "Boston College","North Carolina","Florida State","Notre Dame",
           "Stanford","California","SMU")
  if (t %in% acc) return("ACC")

  sec <- c("Vanderbilt","LSU","Florida","Georgia","Tennessee","South Carolina",
           "Mississippi State","Ole Miss","Arkansas","Auburn","Alabama","Kentucky",
           "Missouri","Texas A&M","Mississippi State")
  if (t %in% sec) return("SEC")
  if (t == "Texas" && year >= 2024) return("SEC")
  if (t == "Oklahoma" && year >= 2024) return("SEC")

  b12 <- c("TCU","Texas Tech","Kansas","Kansas State","Iowa State","Baylor",
           "Oklahoma State","West Virginia")
  if (t %in% b12) return("Big 12")
  if (t == "Texas" && year <= 2023) return("Big 12")
  if (t == "Oklahoma" && year <= 2023) return("Big 12")
  if (t %in% c("BYU","Cincinnati","UCF","Houston") && year >= 2023) return("Big 12")
  if (t %in% c("Arizona","Arizona State","Utah","Colorado") && year >= 2024) return("Big 12")

  b10 <- c("Michigan","Ohio State","Indiana","Maryland","Rutgers","Nebraska",
           "Minnesota","Wisconsin","Iowa","Purdue","Illinois","Northwestern",
           "Penn State","Michigan State")
  if (t %in% b10) return("Big Ten")
  if (t %in% c("UCLA","USC") && year >= 2024) return("Big Ten")

  pac <- c("Oregon","Oregon State","UCLA","USC","Arizona","Arizona State",
           "Washington","Washington State","California","Stanford","Utah","Colorado")
  if (t %in% pac && year <= 2023) return("Pac-12")

  # ── Mid-major FBS ──────────────────────────────────────────
  aac <- c("East Carolina","Tulane","South Florida","Memphis","Temple",
           "Houston","UCF","Cincinnati","Tulsa","Navy","SMU","Wichita State",
           "North Texas","Charlotte","UTSA","Dallas Baptist")
  if (t %in% aac) {
    if (t == "Dallas Baptist" && year >= 2013) return("AAC")
    if (year >= 2013) return("AAC")
    return("C-USA")
  }

  sunbelt <- c("Louisiana","Troy","Appalachian State","Arkansas State",
               "Georgia Southern","Georgia State","South Alabama","UL Monroe",
               "Southern Miss","Texas State","Coastal Carolina","Old Dominion",
               "James Madison","Marshall")
  if (t %in% sunbelt) return("Sun Belt")

  cusa <- c("UAB","Middle Tennessee","Western Kentucky","Florida Atlantic","FIU",
            "UTEP","Louisiana Tech","Rice","Kennesaw State","Jacksonville State",
            "Sam Houston","Liberty","New Mexico State","UTSA","Charlotte")
  if (t %in% cusa) return("C-USA")

  mw <- c("Boise State","San Diego State","Fresno State","Utah State","UNLV",
          "Wyoming","Nevada","New Mexico","Air Force","Colorado State",
          "San Jose State","Hawai'i")
  if (t %in% mw) return("Mountain West")

  mac <- c("Central Michigan","Eastern Michigan","Western Michigan","Northern Illinois",
           "Ball State","Bowling Green","Buffalo","Kent State","Miami (OH)",
           "Ohio","Toledo","Akron")
  if (t %in% mac) return("MAC")

  # ── Mid-major / D1 non-FBS ─────────────────────────────────
  # Big West
  big_west <- c("Cal Poly","UC Santa Barbara","UC Irvine","UC Davis","UC Riverside",
                "UC San Diego","Cal State Fullerton","Long Beach State","Hawai'i",
                "Sacramento State","Cal State Northridge","Cal State Bakersfield")
  if (t %in% big_west) return("Big West")

  # WCC
  wcc <- c("Gonzaga","BYU","San Diego","Santa Clara","Pacific","Loyola Marymount",
           "Portland","San Francisco","Saint Mary's","Pepperdine")
  if (t %in% wcc) return("WCC")

  # MVC
  mvc <- c("Missouri State","Indiana State","Illinois State","Southern Illinois",
           "Bradley","Dallas Baptist","Evansville","Northern Iowa","Valparaiso",
           "Belmont","Indiana State","Illinois State")
  if (t %in% mvc) return("MVC")

  # Horizon
  horizon <- c("Wright State","Milwaukee","Northern Kentucky","Oakland","Purdue Fort Wayne",
               "IU Indianapolis","Green Bay","Cleveland State","Detroit Mercy","Robert Morris",
               "Youngstown State","Illinois-Chicago")
  if (t %in% horizon) return("Horizon")

  # Big South / CAA
  big_south <- c("Campbell","High Point","Gardner-Webb","Longwood","Presbyterian",
                 "SC Upstate","UNC Asheville","Radford","Winthrop","Charleston Southern")
  if (t %in% big_south) return("Big South")

  caa <- c("Northeastern","Delaware","Towson","UNC Wilmington","Elon","College of Charleston",
           "Hofstra","James Madison","Stony Brook","William & Mary","Drexel","Campbell")
  if (t %in% caa) return("CAA")

  # SoCon
  socon <- c("Mercer","Samford","The Citadel","Western Carolina","Furman","Wofford",
             "VMI","Chattanooga","East Tennessee State","UNC Greensboro","Citadel")
  if (t %in% socon) return("SoCon")

  # ASUN / OVC
  asun_ovc <- c("Morehead State","Eastern Kentucky","Tennessee Tech","Murray State",
                "UT Martin","Southeast Missouri","Austin Peay","Eastern Illinois",
                "Bellarmine","North Alabama","Lipscomb","Jacksonville","Stetson",
                "North Florida","Queens","Florida Gulf Coast","Belmont")
  if (t %in% asun_ovc) return("ASUN/OVC")

  # WAC / Southland
  wac_south <- c("Sam Houston","Stephen F. Austin","Abilene Christian","Lamar",
                 "McNeese","Nicholls","SE Louisiana","Northwestern State",
                 "Incarnate Word","Houston Christian","Tarleton State","Grand Canyon",
                 "Cal Baptist","Utah Tech","Seattle","Southern Utah")
  if (t %in% wac_south) return("WAC/Southland")

  # SWAC / MEAC / Other HBCUs
  swac_meac <- c("Grambling","Prairie View A&M","Southern","Alcorn State","Jackson State",
                 "Texas Southern","Alabama State","Alabama A&M","Florida A&M",
                 "Bethune-Cookman","South Carolina State","Howard","Morgan State",
                 "Delaware State","Norfolk State","North Carolina A&T","NC Central",
                 "Savannah State","Mississippi Valley State","Arkansas-Pine Bluff",
                 "Maryland Eastern Shore","Coppin State")
  if (t %in% swac_meac) return("SWAC/MEAC")

  # Ivy / Patriot / MAAC / A-10 / Other
  ivy <- c("Yale","Harvard","Princeton","Dartmouth","Columbia","Cornell","Brown","Penn")
  if (t %in% ivy) return("Ivy League")

  patriot <- c("Colgate","Fordham","Holy Cross","Bucknell","Lafayette","Lehigh","Army","Navy")
  if (t %in% patriot) return("Patriot")

  maac <- c("Fairfield","Manhattan","Rider","Canisius","Niagara","Siena","Quinnipiac",
            "Marist","Monmouth","Iona","Mount St. Mary's")
  if (t %in% maac) return("MAAC")

  a10 <- c("VCU","Dayton","George Mason","Richmond","Davidson","Fordham","La Salle",
           "Saint Joseph's","Saint Louis","George Washington","Duquesne","Massachusetts","Rhode Island","UMass")
  if (t %in% a10) return("A-10")

  big_east_bball <- c("Georgetown","Providence","Creighton","Xavier","DePaul",
                       "Villanova","Butler","Marquette","UConn","Seton Hall","St. John's")
  if (t %in% big_east_bball) return("Big East")

  america_east <- c("Albany","Binghamton","Maine","UMBC","Stony Brook","Vermont",
                    "Maryland-Baltimore County","New Hampshire","Hartford")
  if (t %in% america_east) return("America East")

  # Any remaining unrecognized = treat as non-major
  return("Other D1")
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

# ── Fetch a single day ────────────────────────────────────────
fetch_day_cbase <- function(ds) {
  # Try with groups=11 first, then without for broader coverage
  for (q in list(
    list(dates=ds, groups=11, limit=1000),
    list(dates=ds, limit=1000)
  )) {
    resp <- tryCatch(
      GET("https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard",
          query=q, timeout(30)), error=function(e) NULL)
    if (is.null(resp)||status_code(resp)!=200) next
    data <- tryCatch(fromJSON(rawToChar(resp$content),simplifyDataFrame=FALSE),
                     error=function(e) NULL)
    if (is.null(data)||length(data$events)==0) next
    rows <- Filter(Negate(is.null), lapply(data$events, parse_event))
    if (length(rows) > 0) {
      return(data.frame(
        winner=sapply(rows,`[[`,"winner"), loser=sapply(rows,`[[`,"loser"),
        winner_pts=as.numeric(sapply(rows,`[[`,"winner_pts")),
        loser_pts=as.numeric(sapply(rows,`[[`,"loser_pts")),
        stringsAsFactors=FALSE))
    }
  }
  NULL
}

# ── Fetch full season via daily fetching ──────────────────────
fetch_cbase_season <- function(yr) {
  message("  ESPN API: College Baseball ", yr)
  season_start <- as.Date(paste0(yr, "-02-14"))
  season_end   <- min(as.Date(paste0(yr, "-06-30")), Sys.Date())
  if (season_start > Sys.Date()) {
    message("  Season hasn't started yet — skipping")
    return(NULL)
  }

  all_games <- list()
  dates <- seq(season_start, season_end, by="1 day")
  total_fetched <- 0

  for (d in as.character(dates)) {
    ds  <- gsub("-","",d)
    res <- fetch_day_cbase(ds)
    if (!is.null(res) && nrow(res) > 0) {
      all_games <- c(all_games, list(res))
      total_fetched <- total_fetched + nrow(res)
    }
    # Brief delay only on game days
    if (!is.null(res) && nrow(res) > 0) Sys.sleep(0.12) else Sys.sleep(0.02)
  }

  if (!length(all_games)) return(NULL)

  games <- unique(do.call(rbind, all_games))
  games <- games[!is.na(games$winner) & games$winner!="" &
                 !is.na(games$loser)  & games$loser !="" &
                 games$winner != games$loser, ]

  # Cap run margin (prevent blowouts from inflating Elo)
  games$winner_pts <- pmin(games$winner_pts, games$loser_pts + 10)

  message("  Total: ", nrow(games), " games")
  games
}

# ── Per-season Elo ─────────────────────────────────────────────
for (yr in SEASONS) {
  message("College Baseball ", yr, "...")
  g <- fetch_cbase_season(yr)
  if (is.null(g) || nrow(g) < 50) {
    message("  Skipping — ", if(is.null(g)) 0 else nrow(g), " games"); next
  }

  elo <- run_elo(g, k=30, iters=10, min_games=5)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)
  conf_vec <- setNames(sapply(elo$team, function(t) get_conf_cbase(t, yr)), elo$team)
  out <- build_output(elo, season=yr, conf_map=conf_vec, sos_map=sos)
  out <- as.data.frame(lapply(out, function(x) {
    if (is.list(x)) sapply(x, function(v) if (is.null(v)) NA else as.character(v))
    else x
  }), stringsAsFactors=FALSE)

  write_csv(out, file.path(OUT_DIR, paste0("CBASE_Elo_", yr, ".csv")))
  covered <- sum(!is.na(out$conference) & out$games_played >= 5)
  total5  <- sum(out$games_played >= 5)
  message("  -> ", nrow(out), " teams | conf coverage (5+ gp): ", covered, "/", total5)
}
message("College Baseball done.")
