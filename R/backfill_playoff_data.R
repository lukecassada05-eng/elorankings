#!/usr/bin/env Rscript
# ================================================================
# backfill_playoff_data.R
# Fetches historical playoff/tournament data for all sports and years
# Writes tournament_YEAR.json to each sport's data directory
# Run once to backfill history, then each sport's update script
# handles the current year going forward
# ================================================================
suppressPackageStartupMessages({
  library(jsonlite)
})

fetch_playoff_games <- function(sport_path, start_date, end_date, season_yr=NULL) {
  # CBB: use the tournament bracket API which returns full results cleanly
  if (grepl("mens-college-basketball", sport_path) && !is.null(season_yr)) {
    return(fetch_cbb_bracket(season_yr))
  }
  
  # All other sports: use scoreboard with seasontype=3
  # Chunk into monthly requests to avoid ESPN's response size limit
  all_games <- list()
  cur <- start_date
  while (cur <= end_date) {
    chunk_end <- min(end_date, as.Date(format(cur, "%Y-%m-01")) + 31)
    ds <- gsub("-", "", as.character(cur))
    de <- gsub("-", "", as.character(chunk_end))
    url <- paste0(
      "https://site.api.espn.com/apis/site/v2/sports/", sport_path,
      "/scoreboard?seasontype=3&limit=500&dates=", ds, "-", de
    )
    data <- tryCatch(
      jsonlite::fromJSON(url, simplifyVector = FALSE),
      error = function(e) NULL
    )
    if (!is.null(data) && length(data$events) > 0) {
      for (ev in data$events) {
        tryCatch({
          comp  <- ev$competitions[[1]]
          if (!isTRUE(comp$status$type$completed)) next
          comps <- comp$competitors
          if (length(comps) != 2) next
          scores <- suppressWarnings(as.numeric(sapply(comps, function(c) c$score)))
          names  <- sapply(comps, function(c) c$team$shortDisplayName)
          if (any(is.na(scores)) || scores[1] == scores[2]) next
          wi <- which.max(scores); li <- 3 - wi
          all_games <- c(all_games, list(list(
            winner=names[wi], loser=names[li],
            winner_score=scores[wi], loser_score=scores[li],
            date=tryCatch(substr(comp$date,1,10), error=function(e)"")
          )))
        }, error=function(e) NULL)
      }
    }
    cur <- chunk_end + 1
    Sys.sleep(0.2)
  }
  all_games
}

fetch_cbb_bracket <- function(season_yr) {
  # Uses ESPN tournament bracket API - returns full NCAA bracket with all results
  url <- paste0(
    "https://site.api.espn.com/apis/site/v2/sports/basketball/",
    "mens-college-basketball/tournament/bracket?season=", season_yr
  )
  data <- tryCatch(
    jsonlite::fromJSON(url, simplifyVector = FALSE),
    error = function(e) { message("  CBB bracket API error: ", e$message); NULL }
  )
  if (is.null(data)) return(list())
  
  games <- list()
  # Navigate bracket structure: data$bracket$rounds -> matchups -> competitors
  rounds <- tryCatch(data$bracket$rounds, error=function(e) NULL)
  if (is.null(rounds)) rounds <- tryCatch(data$rounds, error=function(e) NULL)
  if (is.null(rounds)) { message("  CBB: no rounds in bracket API"); return(list()) }
  
  for (rnd in rounds) {
    matchups <- tryCatch(rnd$matchups, error=function(e) NULL)
    if (is.null(matchups)) next
    for (mu in matchups) {
      tryCatch({
        comps <- mu$competitors
        if (is.null(comps) || length(comps) != 2) next
        scores <- suppressWarnings(as.numeric(sapply(comps, function(c) 
          tryCatch(c$score, error=function(e) NA))))
        names  <- sapply(comps, function(c) 
          tryCatch(c$team$shortDisplayName, error=function(e) ""))
        completed <- isTRUE(tryCatch(mu$status$type$completed, error=function(e) FALSE))
        if (!completed || any(is.na(scores)) || nchar(names[1])==0 || nchar(names[2])==0) next
        if (scores[1] == scores[2]) next
        wi <- which.max(scores); li <- 3 - wi
        games <- c(games, list(list(
          winner=names[wi], loser=names[li],
          winner_score=scores[wi], loser_score=scores[li],
          date=tryCatch(substr(mu$date,1,10), error=function(e)"")
        )))
      }, error=function(e) NULL)
    }
  }
  message("  CBB bracket: ", length(games), " completed games")
  games
}

build_series <- function(games, win_to_advance) {
  pair_wins <- list()
  for (g in games) {
    key <- paste(sort(c(g$winner, g$loser)), collapse="|")
    if (is.null(pair_wins[[key]])) 
      pair_wins[[key]] <- list(t1=g$winner, t2=g$loser, w1=0L, w2=0L)
    if (pair_wins[[key]]$t1 == g$winner) pair_wins[[key]]$w1 <- pair_wins[[key]]$w1 + 1L
    else                                  pair_wins[[key]]$w2 <- pair_wins[[key]]$w2 + 1L
  }
  series <- list(); eliminated <- c()
  for (key in names(pair_wins)) {
    s    <- pair_wins[[key]]
    done <- (s$w1 >= win_to_advance || s$w2 >= win_to_advance)
    loser<- if (done) (if (s$w1 < s$w2) s$t1 else s$t2) else ""
    if (done && nchar(loser) > 0) eliminated <- c(eliminated, loser)
    series <- c(series, list(list(
      t1=s$t1, t2=s$t2, w1=s$w1, w2=s$w2, done=done, loser=loser
    )))
  }
  list(series=series, eliminated=as.list(unique(eliminated)))
}

write_tournament_json <- function(sport_name, season_yr, games_yr, 
                                   out_dir, win_to_advance,
                                   start_mo, start_day, end_mo, end_day) {
  start <- as.Date(sprintf("%d-%02d-%02d", games_yr, start_mo, start_day))
  end   <- as.Date(sprintf("%d-%02d-%02d", games_yr, end_mo, end_day))
  today <- Sys.Date()
  
  # Don't fetch future playoffs
  if (start > today) {
    message("  Skipping ", season_yr, " — playoffs haven't started yet")
    return(invisible(NULL))
  }
  
  fetch_end <- min(end, today)
  games <- fetch_playoff_games(
    switch(sport_name,
      "NBA"="basketball/nba",
      "NHL"="hockey/nhl", 
      "MLB"="baseball/mlb",
      "NFL"="football/nfl",
      "CBB"="basketball/mens-college-basketball",
      "CBASE"="baseball/college-baseball"
    ),
    start, fetch_end,
    season_yr = season_yr
  )
  
  built <- build_series(games, win_to_advance)
  
  # Determine if season is complete
  completed <- (fetch_end >= end || (today > end))
  
  result <- list(
    year      = season_yr,
    sport     = sport_name,
    completed = completed,
    games     = games,
    series    = built$series,
    eliminated= built$eliminated,
    updated   = format(Sys.time(), "%Y-%m-%d %H:%M UTC")
  )
  
  out_file <- file.path(out_dir, paste0("tournament_", season_yr, ".json"))
  jsonlite::write_json(result, out_file, auto_unbox=TRUE, pretty=TRUE)
  message("  Written: ", out_file, " (", length(games), " games, completed=", completed, ")")
}

# ================================================================
# SPORT CONFIGURATIONS
# season_yr = the season label (what the CSV uses)
# games_yr  = calendar year when playoffs actually happen
# For NFL: games_yr = season_yr + 1 (Jan/Feb of next year)
# For others: games_yr = season_yr
# ================================================================

configs <- list(
  list(sport="NBA",   dir="docs/NBA/data",   win=4, 
       start_mo=4, start_day=13, end_mo=6, end_day=30,
       seasons=2002:2026, games_yr_offset=0),
  list(sport="NHL",   dir="docs/NHL/data",   win=4,
       start_mo=4, start_day=11, end_mo=7, end_day=15,
       seasons=2013:2026, games_yr_offset=0),
  list(sport="MLB",   dir="docs/MLB/data",   win=3,
       start_mo=10, start_day=1, end_mo=11, end_day=10,
       seasons=2001:2026, games_yr_offset=0),
  list(sport="NFL",   dir="docs/NFL/data",   win=1,
       start_mo=1, start_day=10, end_mo=2, end_day=15,
       seasons=2001:2025, games_yr_offset=1),
  list(sport="CBB",   dir="docs/CBB/data",   win=1,
       start_mo=3, start_day=14, end_mo=4, end_day=10,
       seasons=2003:2026, games_yr_offset=0),
  list(sport="CBASE", dir="docs/CollegeBaseball/data", win=2,
       start_mo=5, start_day=28, end_mo=6, end_day=25,
       seasons=2018:2026, games_yr_offset=0)
)

for (cfg in configs) {
  message("\n=== ", cfg$sport, " ===")
  dir.create(cfg$dir, showWarnings=FALSE, recursive=TRUE)
  for (yr in cfg$seasons) {
    message("  ", cfg$sport, " ", yr, "...")
    games_yr <- yr + cfg$games_yr_offset
    write_tournament_json(
      sport_name    = cfg$sport,
      season_yr     = yr,
      games_yr      = games_yr,
      out_dir       = cfg$dir,
      win_to_advance= cfg$win,
      start_mo      = cfg$start_mo,
      start_day     = cfg$start_day,
      end_mo        = cfg$end_mo,
      end_day       = cfg$end_day
    )
    Sys.sleep(0.3)  # be nice to ESPN API
  }
}

message("\nBackfill complete!")
