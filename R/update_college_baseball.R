# ================================================================
# R/update_college_baseball.R  —  NCAA D1 Baseball, 2018–current
# Data: ESPN scoreboard API
#
# FIXES:
#  1. limit=1000 + date range fetching (week batches)
#  2. Exhaustive conference map covering ALL teams from the data
#  3. Year-aware for conference moves
#  4. Mid-major conferences (SoCon, Big West, WCC, CAA, MVC, etc.)
# ================================================================
suppressPackageStartupMessages({
  library(dplyr); library(readr); library(httr); library(jsonlite)
})
source("R/elo_engine.R")

CURRENT_YEAR <- as.integer(format(Sys.Date(), "%Y"))
SEASONS <- 2018:(CURRENT_YEAR + 1L)  # +1 catches next season if started
OUT_DIR  <- "docs/CollegeBaseball/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

# ================================================================
# Year-aware conference function for college baseball
# ================================================================
get_conf_cbase <- function(team, year) {
  t <- trimws(team)

  # ── ACC ───────────────────────────────────────────────────
  acc <- c("Clemson","Florida St","Florida State","NC State","North Carolina St",
           "Virginia","Wake Forest","Georgia Tech","Duke","Miami","Louisville",
           "Pitt","Pittsburgh","North Carolina","UNC","Notre Dame",
           "Boston College","BC","Syracuse","Stanford","SMU","Cal","California",
           "Virginia Tech","VT","FSU","GT")
  if (t %in% acc) return("ACC")

  # ── SEC ───────────────────────────────────────────────────
  sec_base <- c("Vanderbilt","LSU","Florida","Georgia","Tennessee",
                "South Carolina","Miss St","Mississippi State","Mississippi St",
                "Ole Miss","Arkansas","Auburn","Alabama","Kentucky",
                "Missouri","Texas A&M")
  if (t %in% sec_base) return("SEC")
  if (t == "Texas" && year >= 2024) return("SEC")
  if (t == "Oklahoma" && year >= 2024) return("SEC")

  # ── BIG 12 ────────────────────────────────────────────────
  b12_base <- c("TCU","Texas Christian","Texas Tech","Kansas","Kansas St",
                "Kansas State","Baylor","Oklahoma St","Oklahoma State",
                "West Virginia","Iowa St","Iowa State")
  if (t %in% b12_base) return("Big 12")
  if (t == "Texas" && year <= 2023) return("Big 12")
  if (t == "Oklahoma" && year <= 2023) return("Big 12")
  if (t %in% c("BYU","Cincinnati","UCF","Houston") && year >= 2023) return("Big 12")
  if (t %in% c("Arizona","Arizona St","Arizona State","Colorado","Utah") &&
      year >= 2024) return("Big 12")

  # ── BIG TEN ───────────────────────────────────────────────
  b10 <- c("Michigan","Ohio St","Ohio State","Indiana","Maryland","Rutgers",
           "Nebraska","Minnesota","Illinois","Iowa","Purdue","Northwestern",
           "Penn St","Penn State","Michigan St","Michigan State")
  if (t %in% b10) return("Big Ten")
  if (t %in% c("UCLA","USC") && year >= 2024) return("Big Ten")
  if (t == "Washington" && year >= 2024) return("Big Ten")

  # ── PAC-12 ────────────────────────────────────────────────
  pac <- c("Oregon St","Oregon State","UCLA","USC","Arizona","Arizona St",
           "Arizona State","Washington","Washington St","Washington State",
           "Stanford","California","Cal","Utah","Colorado","Oregon")
  if (t %in% pac && year <= 2023) return("Pac-12")
  if (t %in% c("Oregon St","Oregon State") && year >= 2024) return("Pac-12")
  if (t == "Oregon" && year <= 2023) return("Pac-12")

  # ── AAC ───────────────────────────────────────────────────
  aac <- c("East Carolina","Tulane","South Florida","Wichita St","UCF",
           "Memphis","Houston","Navy","Temple","Dallas Baptist",
           "USF","Cincinnati","Tulsa","Charlotte")
  if (t %in% aac) return("AAC")

  # ── SUN BELT ──────────────────────────────────────────────
  sunbelt <- c("Louisiana","Troy","GA Southern","Georgia So","Georgia Southern",
               "App State","Appalachian State","Arkansas St","Arkansas State",
               "South Alabama","James Madison","Old Dominion","Georgia St",
               "Georgia State","UL Monroe","Coastal","Coastal Car",
               "Coastal Carolina","Southern Miss","Texas St","Texas State",
               "GA St","Marshall")
  if (t %in% sunbelt) return("Sun Belt")

  # ── C-USA ─────────────────────────────────────────────────
  cusa <- c("Western KY","Western Kentucky","MTSU","Middle Tennessee",
            "FAU","Florida Atlantic","Rice","UAB","UTSA","Charlotte",
            "FIU","Louisiana Tech","New Mexico St","New Mexico State",
            "Sam Houston","Liberty","Kennesaw St","Kennesaw State",
            "Jax State","Jacksonville St","Jacksonville State")
  if (t %in% cusa) return("C-USA")

  # ── MAC ───────────────────────────────────────────────────
  mac <- c("Central Michigan","C Michigan","Ball State","Ohio","Kent State",
           "Kent St","Bowling Green","Buffalo","Miami OH","Miami (OH)",
           "W Michigan","Western Michigan","E Michigan","Eastern Michigan",
           "N Illinois","Northern Illinois","Toledo","Akron")
  if (t %in% mac) return("MAC")

  # ── MOUNTAIN WEST ─────────────────────────────────────────
  mw <- c("San Diego St","San Diego State","Nevada","UNLV","New Mexico",
          "Fresno St","Fresno State","Air Force","Utah St","Utah State",
          "Colorado St","Colorado State","San José St","San Jose St",
          "San Jose State","Hawaii","Hawai'i","Nevada","Wyoming",
          "Boise St","Boise State","UNLV")
  if (t %in% mw) return("Mountain West")

  # ── SOUTHERN CONFERENCE (SoCon) ───────────────────────────
  socon <- c("Mercer","Samford","The Citadel","W Carolina","Western Carolina",
             "Furman","Wofford","VMI","Chattanooga","ETSU","UNC Greensboro",
             "Citadel")
  if (t %in% socon) return("SoCon")

  # ── BIG WEST ──────────────────────────────────────────────
  big_west <- c("Cal Poly","Santa Barbara","UC Santa Barbara",
                "UC Irvine","UC Davis","UC San Diego","UC Riverside",
                "Cal State Fullerton","Fullerton","Long Beach St",
                "CSUN","Northridge","Hawai'i","Hawaii","Sacramento St",
                "Sacramento State","UC Santa Barbara")
  if (t %in% big_west) return("Big West")

  # ── WEST COAST CONFERENCE (WCC) ───────────────────────────
  wcc <- c("Gonzaga","San Diego","BYU","Santa Clara","Pacific",
           "Loyola Marymount","LMU","Portland","San Francisco",
           "Saint Mary's","Pepperdine","Brigham Young")
  if (t %in% wcc) return("WCC")

  # ── MVC (Missouri Valley) ─────────────────────────────────
  mvc <- c("Missouri St","Missouri State","Indiana St","Indiana State",
           "Illinois St","Illinois State","S Illinois","Southern Illinois",
           "Bradley","Dallas Baptist","Evansville","UNI","Northern Iowa",
           "Valparaiso","Belmont")
  if (t %in% mvc) return("MVC")

  # ── BIG SOUTH / CAA ───────────────────────────────────────
  big_south <- c("Campbell","High Point","Gardner-Webb","Longwood",
                 "Presbyterian","SC Upstate","UNC Asheville","Radford",
                 "Winthrop","Charleston So")
  if (t %in% big_south) return("Big South")

  caa <- c("Northeastern","Delaware","Towson","UNC Wilmington","Elon",
           "College of Charleston","Charleston","Hofstra","James Madison",
           "Campbell","Stony Brook","William & Mary","Drexel")
  if (t %in% caa) return("CAA")

  # ── IVY LEAGUE ────────────────────────────────────────────
  ivy <- c("Yale","Harvard","Princeton","Columbia","Cornell",
           "Brown","Dartmouth","Penn")
  if (t %in% ivy) return("Ivy League")

  # ── OVC / ASUN ────────────────────────────────────────────
  ovc_asun <- c("Morehead St","Morehead State","Eastern Kentucky","E Kentucky",
                "Tennessee Tech","Murray St","Murray State","UT Martin",
                "SE Missouri","SEMO","Austin Peay","Eastern Illinois","E Illinois",
                "Bellarmine","ETSU","North Alabama","Lipscomb",
                "Florida Gulf Coast","FGCU","Jacksonville","Stetson",
                "North Florida","Queens")
  if (t %in% ovc_asun) return("ASUN/OVC")

  # ── WAC ──────────────────────────────────────────────────
  wac <- c("CA Baptist","Cal Baptist","Grand Canyon","GCU",
           "Tarleton St","Tarleton State","Utah Valley",
           "Utah Tech","Seattle U","Seattle","Southern Utah",
           "Abilene Christian","Lamar","Sam Houston","Stephen F. Austin","SF Austin",
           "Sacramento St","Sacramento State")
  if (t %in% wac) return("WAC")

  # ── SOUTHLAND ─────────────────────────────────────────────
  southland <- c("McNeese","McNeese St","Nicholls","Incarnate Word",
                 "Houston Christian","Hou Christian","New Orleans",
                 "Northwestern St","N'Western St","SE Louisiana",
                 "Texas A&M-CC","Southeastern Louisiana")
  if (t %in% southland) return("Southland")

  # ── SWAC ──────────────────────────────────────────────────
  swac <- c("Grambling","Prairie View","Southern","Alcorn St",
            "Alabama A&M","Alabama St","Jackson St","Texas Southern",
            "Bethune","Florida A&M","Miss Valley St","AR-Pine Bluff")
  if (t %in% swac) return("SWAC")

  # ── HORIZON LEAGUE ────────────────────────────────────────
  horizon <- c("Wright St","Wright State","Milwaukee","Northern Kentucky",
               "N Kentucky","Oakland","Purdue FW","Valparaiso","IUPUI",
               "IU Indianapolis","Green Bay","Cleveland St","Detroit Mercy",
               "Robert Morris","Youngstown St")
  if (t %in% horizon) return("Horizon")

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

# ── Fetch a single date ───────────────────────────────────────
fetch_date <- function(ds) {
  for (q in list(
    list(dates=ds, limit=1000),
    list(dates=ds, limit=1000, groups=11)
  )) {
    resp <- tryCatch(
      GET("https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard",
          query=q, timeout(30)), error=function(e) NULL)
    if (is.null(resp)||status_code(resp)!=200) next
    data <- tryCatch(fromJSON(rawToChar(resp$content),simplifyDataFrame=FALSE),
                     error=function(e) NULL)
    if (is.null(data)||length(data$events)==0) next
    rows <- Filter(Negate(is.null), lapply(data$events, parse_event))
    if (length(rows)>0) return(data.frame(
      winner=sapply(rows,`[[`,"winner"), loser=sapply(rows,`[[`,"loser"),
      winner_pts=as.numeric(sapply(rows,`[[`,"winner_pts")),
      loser_pts=as.numeric(sapply(rows,`[[`,"loser_pts")),
      stringsAsFactors=FALSE))
  }
  NULL
}

# ── Fetch a date range (YYYYMMDD-YYYYMMDD) ────────────────────
fetch_range <- function(start_ds, end_ds) {
  ds_range <- paste0(start_ds, "-", end_ds)
  resp <- tryCatch(
    GET("https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard",
        query=list(dates=ds_range, limit=1000), timeout(30)),
    error=function(e) NULL)
  if (is.null(resp)||status_code(resp)!=200) return(NULL)
  data <- tryCatch(fromJSON(rawToChar(resp$content),simplifyDataFrame=FALSE),
                   error=function(e) NULL)
  if (is.null(data)||length(data$events)==0) return(NULL)
  rows <- Filter(Negate(is.null), lapply(data$events, parse_event))
  if (!length(rows)) return(NULL)
  data.frame(winner=sapply(rows,`[[`,"winner"), loser=sapply(rows,`[[`,"loser"),
             winner_pts=as.numeric(sapply(rows,`[[`,"winner_pts")),
             loser_pts=as.numeric(sapply(rows,`[[`,"loser_pts")),
             stringsAsFactors=FALSE)
}

# ── Fetch full season ─────────────────────────────────────────
fetch_cbase_season <- function(yr) {
  message("  ESPN API: College Baseball ", yr)
  season_start <- as.Date(paste0(yr, "-02-14"))
  season_end   <- min(as.Date(paste0(yr, "-06-30")), Sys.Date())
  if (season_start > Sys.Date()) return(NULL)

  all_games <- list()

  # Pass 1: week-range batches (efficient, captures all games per week)
  week_starts <- seq(season_start, season_end, by="7 days")
  for (ws in as.character(week_starts)) {
    we  <- min(as.Date(ws) + 6, season_end)
    res <- fetch_range(gsub("-","",ws), gsub("-","",as.character(we)))
    if (!is.null(res)&&nrow(res)>0) all_games <- c(all_games, list(res))
    Sys.sleep(0.3)
  }

  # Pass 2: individual days for any week that returned 0 games
  # (catches days ESPN didn't include in the range response)
  range_games <- if (length(all_games) > 0) nrow(do.call(rbind, all_games)) else 0
  if (range_games < 200) {
    message("  Range returned only ", range_games, " games; adding daily fetch...")
    dates <- seq(season_start, season_end, by="1 day")
    for (d in as.character(dates)) {
      res <- fetch_date(gsub("-","",d))
      if (!is.null(res)&&nrow(res)>0) all_games <- c(all_games, list(res))
      Sys.sleep(0.12)
    }
  }

  if (!length(all_games)) return(NULL)
  games <- unique(do.call(rbind, all_games))
  games <- games[!is.na(games$winner)&games$winner!=""&
                 !is.na(games$loser) &games$loser !=""&
                 games$winner!=games$loser, ]
  games$winner_pts <- pmin(games$winner_pts, games$loser_pts + 12)
  games
}

# ── Per-season Elo ─────────────────────────────────────────────
for (yr in SEASONS) {
  message("College Baseball ", yr, "...")
  g <- fetch_cbase_season(yr)
  if (is.null(g)||nrow(g)<50) {
    message("  Skipping — ", if(is.null(g)) 0 else nrow(g), " games"); next
  }
  message("  Total: ", nrow(g), " games")

  elo <- run_elo(g, k=30, iters=10, min_games=5)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)
  conf_vec <- setNames(sapply(elo$team, function(t) get_conf_cbase(t, yr)), elo$team)
  out <- build_output(elo, season=yr, conf_map=conf_vec, sos_map=sos)
  out <- as.data.frame(lapply(out, function(x) {
    if(is.list(x)) sapply(x, function(v) if(is.null(v)) NA else as.character(v))
    else x
  }), stringsAsFactors=FALSE)

  write_csv(out, file.path(OUT_DIR, paste0("CBASE_Elo_", yr, ".csv")))
  covered <- sum(!is.na(out$conference) & out$games_played >= 5)
  total5  <- sum(out$games_played >= 5)
  message("  -> ", nrow(out), " teams | conf (5+ gp): ", covered, "/", total5)
}
message("College Baseball done.")
