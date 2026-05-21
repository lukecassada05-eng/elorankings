# ================================================================
# R/update_college_baseball.R  —  NCAA D1 Baseball, 2018–current
# Data: ESPN scoreboard API (dates=YYYYMMDD)
#
# FIXES:
#  1. Year-aware conference map (same pattern as CFB)
#  2. Conference moves handled per year (e.g. Texas/Oklahoma to SEC 2024,
#     UCLA/USC to Big Ten 2024, etc.)
#  3. Fetch every day (no weekday filter) for complete coverage
# ================================================================
suppressPackageStartupMessages({
  library(dplyr); library(readr); library(httr); library(jsonlite)
})
source("R/elo_engine.R")

CURRENT_YEAR <- as.integer(format(Sys.Date(), "%Y"))
SEASONS <- 2018:CURRENT_YEAR
OUT_DIR  <- "docs/CollegeBaseball/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

# ── Year-aware conference function ────────────────────────────
get_conf_cbase <- function(team, year) {
  t <- trimws(team)

  # ACC
  acc <- c("Clemson","Florida St","Florida State","NC State","North Carolina St",
           "Virginia","Wake Forest","Georgia Tech","Duke","Miami","Louisville",
           "Pitt","Pittsburgh","North Carolina","Notre Dame","Boston College",
           "Syracuse","Stanford","SMU","Cal","California")
  if (t %in% acc) return("ACC")

  # SEC
  sec_base <- c("Vanderbilt","LSU","Florida","Georgia","Tennessee",
                "South Carolina","Miss St","Mississippi State","Ole Miss",
                "Arkansas","Auburn","Alabama","Kentucky","Missouri","Texas A&M")
  if (t %in% sec_base) return("SEC")
  if (t == "Texas" && year >= 2024) return("SEC")
  if (t == "Oklahoma" && year >= 2024) return("SEC")

  # Big 12
  b12_base <- c("TCU","Texas Christian","Texas Tech","Kansas","Kansas St",
                "Kansas State","Baylor","Oklahoma St","Oklahoma State",
                "West Virginia","Iowa St","Iowa State")
  if (t %in% b12_base) return("Big 12")
  if (t == "Texas" && year <= 2023) return("Big 12")
  if (t == "Oklahoma" && year <= 2023) return("Big 12")
  if (t %in% c("BYU","Cincinnati","UCF","Houston") && year >= 2023) return("Big 12")
  if (t %in% c("Arizona","Arizona St","Arizona State","Colorado","Utah") &&
      year >= 2024) return("Big 12")

  # Big Ten
  b10 <- c("Michigan","Ohio St","Ohio State","Indiana","Maryland","Rutgers",
           "Nebraska","Minnesota","Illinois","Iowa","Purdue","Northwestern",
           "Penn St","Penn State","Michigan St","Michigan State")
  if (t %in% b10) return("Big Ten")
  if (t %in% c("UCLA","USC") && year >= 2024) return("Big Ten")

  # Pac-12
  pac <- c("Oregon St","Oregon State","UCLA","USC","Arizona","Arizona St",
           "Arizona State","Washington","Washington St","Washington State",
           "Stanford","California","Cal","Utah","Colorado","Oregon")
  if (t %in% pac && year <= 2023) return("Pac-12")
  if (t %in% c("Oregon St","Oregon State") && year >= 2024) return("Pac-12")

  # AAC
  aac <- c("East Carolina","Tulane","South Florida","Wichita St","UCF",
           "Memphis","Houston","Navy","Temple","Dallas Baptist")
  if (t %in% aac) return("AAC")

  # Sun Belt
  sunbelt <- c("Louisiana","Troy","GA Southern","Georgia So","Georgia Southern",
               "App State","Appalachian State","Arkansas St","Arkansas State",
               "South Alabama","James Madison","Old Dominion","Georgia St",
               "Georgia State","UL Monroe","Coastal Car","Coastal Carolina",
               "Southern Miss","Texas St","Texas State")
  if (t %in% sunbelt) return("Sun Belt")

  # C-USA
  cusa <- c("Western KY","Western Kentucky","MTSU","Middle Tennessee",
            "FAU","Florida Atlantic","Rice","UAB","UTSA","Charlotte",
            "FIU","Louisiana Tech","New Mexico St","New Mexico State",
            "Sam Houston","Liberty")
  if (t %in% cusa) return("C-USA")

  # MAC
  mac <- c("Central Michigan","C Michigan","Ball State","Ohio","Kent State",
           "Kent St","Bowling Green","Buffalo","Miami OH","Miami (OH)",
           "W Michigan","Western Michigan","E Michigan","Eastern Michigan",
           "N Illinois","Northern Illinois","Toledo","Akron")
  if (t %in% mac) return("MAC")

  # Mountain West
  mw <- c("San Diego St","San Diego State","Nevada","UNLV","New Mexico",
          "Fresno St","Fresno State","Air Force","Utah St","Utah State",
          "Colorado St","Colorado State","San José St","San Jose St",
          "San Jose State","Hawaii","Hawai'i")
  if (t %in% mw) return("Mountain West")

  # MVC / A-10 and other mid-majors — leave as NA, not worth mapping all
  return(NA_character_)
}

# ── Parse one ESPN event ──────────────────────────────────────
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
  for (q in list(list(dates=ds,limit=500), list(dates=ds,limit=500,groups=11))) {
    resp <- tryCatch(
      GET("https://site.api.espn.com/apis/site/v2/sports/baseball/college-baseball/scoreboard",
          query=q, timeout(20)), error=function(e) NULL)
    if (is.null(resp)||status_code(resp)!=200) next
    data <- tryCatch(fromJSON(rawToChar(resp$content),simplifyDataFrame=FALSE),
                     error=function(e) NULL)
    if (is.null(data)||length(data$events)==0) next
    rows <- Filter(Negate(is.null), lapply(data$events, parse_event))
    if (length(rows)>0) {
      return(data.frame(
        winner=sapply(rows,`[[`,"winner"), loser=sapply(rows,`[[`,"loser"),
        winner_pts=as.numeric(sapply(rows,`[[`,"winner_pts")),
        loser_pts=as.numeric(sapply(rows,`[[`,"loser_pts")),
        stringsAsFactors=FALSE))
    }
  }
  NULL
}

for (yr in SEASONS) {
  message("College Baseball ", yr, "...")
  dates <- seq(as.Date(paste0(yr,"-02-14")),
               min(as.Date(paste0(yr,"-06-30")), Sys.Date()), by="1 day")
  all_games <- list()
  n_days <- 0
  for (d in as.character(dates)) {
    res <- fetch_date(gsub("-","",d))
    if (!is.null(res)&&nrow(res)>0) { all_games <- c(all_games, list(res)); n_days <- n_days+1 }
    Sys.sleep(0.12)
  }
  message("  Days with games: ", n_days)
  if (!length(all_games)) { message("  Skip"); next }

  g <- unique(do.call(rbind, all_games))
  g <- g[!is.na(g$winner)&g$winner!=""&g$winner!=g$loser,]
  g$winner_pts <- pmin(g$winner_pts, g$loser_pts+12)

  if (nrow(g)<50) { message("  Skip — only ",nrow(g)," games"); next }
  message("  ", nrow(g), " games")

  elo <- run_elo(g, k=30, iters=10, min_games=5)
  elo <- attach_best_wins(elo, g)
  sos <- compute_sos(g, elo)

  conf_vec <- setNames(
    sapply(elo$team, function(t) get_conf_cbase(t, yr)),
    elo$team
  )

  out <- build_output(elo, season=yr, conf_map=conf_vec, sos_map=sos)
  out <- as.data.frame(lapply(out, function(x) {
    if(is.list(x)) sapply(x, function(v) if(is.null(v)) NA else as.character(v))
    else x
  }), stringsAsFactors=FALSE)

  write_csv(out, file.path(OUT_DIR, paste0("CBASE_Elo_", yr, ".csv")))
  covered <- sum(!is.na(out$conference) & out$games_played >= 5)
  total5  <- sum(out$games_played >= 5)
  message("  -> ", nrow(out), " teams | conf (5+ games): ", covered, "/", total5)
}
message("College Baseball done.")
