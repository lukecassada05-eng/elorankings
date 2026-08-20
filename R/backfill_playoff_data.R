#!/usr/bin/env Rscript
# backfill_playoff_data.R — writes tournament_YEAR.json for all sports/years

suppressPackageStartupMessages({ library(jsonlite) })

# ── Normalise round name: strip "Game N" suffix so all games in a series share a key ──
normalise_round <- function(rnd) {
  if (is.null(rnd)||is.na(rnd)||!nchar(rnd)) return("")
  # "2025 NBA Playoffs - Eastern Conference First Round - Game 3" → "Eastern Conference First Round"
  # Remove "- Game N" or "Game N" at end
  rnd <- gsub("\\s*[-–]?\\s*Game\\s+\\d+\\s*$", "", rnd, perl=TRUE)
  # Remove leading year/league prefix  e.g. "2025 NBA Playoffs - "
  rnd <- gsub("^\\d{4}\\s+\\w[^-]+-\\s*", "", rnd, perl=TRUE)
  # Remove trailing " - "
  rnd <- gsub("\\s*[-–]\\s*$", "", rnd, perl=TRUE)
  trimws(rnd)
}

# ── Skip non-playoff events ─────────────────────────────────────────────────
is_skip_event <- function(ev_name, notes_text) {
  name_lower  <- tolower(if(is.null(ev_name)||is.na(ev_name)) "" else ev_name)
  notes_lower <- tolower(if(is.null(notes_text)||is.na(notes_text)) "" else notes_text)
  combined    <- paste(name_lower, notes_lower)

  # Exact Pro Bowl check: "nfc vs. afc" is the Pro Bowl game name
  if (grepl("nfc vs.*afc|afc vs.*nfc", name_lower, perl=TRUE)) return(TRUE)

  skip_terms <- c("pro bowl","all-star","all star","skills competition",
                  "celebrity game","rising stars","draft combine",
                  "summer league","exhibition","preseason","scrimmage",
                  "hall of fame")
  any(sapply(skip_terms, function(w) grepl(w, combined, fixed=TRUE)))
}

# ── Fetch scoreboard games (NBA/NHL/MLB/NFL/CBASE) ─────────────────────────
fetch_scoreboard_games <- function(sport_path, start_date, end_date,
                                   season_types = c("3")) {
  all_games <- list()
  seen      <- list()
  cur       <- start_date

  while (cur <= end_date) {
    chunk_end <- min(end_date, as.Date(format(cur, "%Y-%m-01")) + 31)
    ds <- gsub("-", "", as.character(cur))
    de <- gsub("-", "", as.character(chunk_end))

    for (stype in season_types) {
      url <- paste0("https://site.api.espn.com/apis/site/v2/sports/",
                    sport_path, "/scoreboard?seasontype=", stype,
                    "&limit=500&dates=", ds, "-", de)
      data <- tryCatch(jsonlite::fromJSON(url, simplifyVector = FALSE),
                       error = function(e) NULL)
      if (is.null(data) || length(data$events) == 0) next

      for (ev in data$events) {
        tryCatch({
          ev_name <- tryCatch(ev$name, error = function(e) "")
          comp    <- ev$competitions[[1]]
          notes_text <- tryCatch(comp$notes[[1]]$headline, error = function(e) "")

          if (is_skip_event(ev_name, notes_text)) next
          if (!isTRUE(comp$status$type$completed)) next

          comps  <- comp$competitors
          if (length(comps) != 2) next
          scores <- suppressWarnings(as.numeric(sapply(comps, function(c) c$score)))
          names  <- sapply(comps, function(c) c$team$displayName)
          if (any(is.na(scores)) || scores[1] == scores[2] || any(nchar(names) == 0)) next

          wi  <- which.max(scores); li <- 3 - wi
          dt  <- tryCatch(substr(comp$date, 1, 10), error = function(e) "")
          dup <- paste(names[wi], names[li], dt, sep = "|")
          if (!is.null(seen[[dup]])) next
          seen[[dup]] <- TRUE

          # Round name — strip "Game N" so all games in same series share a key
          rnd_raw <- if (!is.null(notes_text) && nchar(notes_text) > 0) notes_text
                     else if (stype == "5") "Play-In" else ""
          rnd <- normalise_round(rnd_raw)

          all_games <- c(all_games, list(list(
            winner = names[wi], loser = names[li],
            winner_score = scores[wi], loser_score = scores[li],
            date = dt, round = rnd
          )))
        }, error = function(e) NULL)
      }
      Sys.sleep(0.12)
    }
    cur <- chunk_end + 1
    Sys.sleep(0.08)
  }
  message("    fetched ", length(all_games), " games")
  all_games
}

# ── CBB: NCAA tournament games only ─────────────────────────────────────────
# NOTE: the CBB date window (see get_dates(), ~Mar 14 - Apr 10) spans BOTH
# conference tournaments and the NCAA tournament, since ESPN tags conference
# tournament games with seasontype=3 (postseason) just like the NCAA
# tournament. Every path below must filter by round name to keep NCAA-only
# games, or the bracket ends up polluted with hundreds of conference-tourney
# results grouped into bogus "series".
CBB_NCAA_ROUNDS <- c("First Four", "First Round", "Second Round", "Round of 64",
                     "Round of 32", "Sweet 16", "Elite Eight", "Final Four",
                     "Championship", "National")
CBB_CONF_TERMS  <- c("Conference", "A-10", "ACC", "SEC", "Big Ten", "Big 12",
                     "Pac-", "American", "Mountain West", "Sun Belt", "MAC",
                     "CUSA", "MWC", "AAC", "Ivy", "Patriot", "Colonial",
                     "Horizon", "Summit", "Big South", "America East")

cbb_is_ncaa_round <- function(rnd) {
  if (is.null(rnd) || !nchar(rnd)) return(NA)  # unknown round: caller decides
  is_ncaa <- any(sapply(CBB_NCAA_ROUNDS, function(x) grepl(x, rnd, ignore.case = TRUE)))
  is_conf <- any(sapply(CBB_CONF_TERMS,  function(x) grepl(x, rnd, fixed = TRUE)))
  is_ncaa && !is_conf
}

fetch_cbb_games <- function(season_yr, start = NULL, end = NULL) {
  if (is.null(start)) start <- as.Date(paste0(season_yr, "-03-14"))
  if (is.null(end))   end   <- as.Date(paste0(season_yr, "-04-10"))
  today <- Sys.Date()
  if (start > today) return(list())
  end <- min(end, today)

  # Primary: reuse the proven ESPN-scoreboard fetcher (same pattern used
  # successfully for NBA/NHL/MLB/NFL/CBASE), then keep only games whose
  # round name reads as NCAA-tournament (not a conference tournament).
  raw <- fetch_scoreboard_games("basketball/mens-college-basketball", start, end, c("3"))
  filtered <- Filter(function(g) isTRUE(cbb_is_ncaa_round(g$round)), raw)

  if (length(filtered) > 0) {
    message("    CBB scoreboard: ", length(filtered), " NCAA tournament games for ", season_yr,
            " (", length(raw) - length(filtered), " conference-tourney/other games excluded)")
    return(filtered)
  }

  message("    CBB scoreboard yielded no identifiable NCAA games (raw=", length(raw),
          "), trying hoopR...")

  # Fallback: hoopR schedule data (works in GitHub Actions since update_cbb.R uses it)
  games2 <- tryCatch({
    if (!requireNamespace("hoopR", quietly = TRUE)) stop("hoopR not available")
    sched <- hoopR::load_mbb_schedule(seasons = season_yr)
    if (is.null(sched) || nrow(sched) == 0) stop("empty schedule")

    tourn <- sched[
      !is.na(sched$season_type) &
      as.character(sched$season_type) == "3" &
      !is.na(sched$game_date) &
      as.Date(sched$game_date) >= start &
      as.Date(sched$game_date) <= end &
      !is.na(sched$home_score) & !is.na(sched$away_score),
    ]
    if (nrow(tourn) == 0) stop("no tournament rows")

    seen2 <- list(); out2 <- list()
    for (i in seq_len(nrow(tourn))) {
      row <- tourn[i, ]
      hs  <- suppressWarnings(as.numeric(row$home_score))
      as_ <- suppressWarnings(as.numeric(row$away_score))
      if (is.na(hs) || is.na(as_) || hs == as_) next

      hn <- tryCatch(as.character(row$home_team_name),
               error = function(e) as.character(row$home_short_display_name))
      an <- tryCatch(as.character(row$away_team_name),
               error = function(e) as.character(row$away_short_display_name))
      if (is.na(hn) || is.na(an) || nchar(hn) == 0 || nchar(an) == 0) next

      dt <- tryCatch(as.character(as.Date(row$game_date)), error = function(e) "")
      dk <- paste(hn, an, dt, sep = "|")
      if (!is.null(seen2[[dk]])) next
      seen2[[dk]] <- TRUE

      rnd <- tryCatch(as.character(row$notes_headline), error = function(e) "")
      if (is.null(rnd) || is.na(rnd)) rnd <- ""
      rnd <- normalise_round(rnd)
      ncaa_check <- cbb_is_ncaa_round(rnd)
      if (isFALSE(ncaa_check)) next  # explicitly identified as non-NCAA; drop
      # NA (unknown round) is kept — better to keep an unlabeled tourney game
      # than silently drop it.

      if (hs > as_) { winner <- hn; loser <- an; ws <- hs; ls <- as_ }
      else          { winner <- an; loser <- hn; ws <- as_; ls <- hs  }

      out2 <- c(out2, list(list(
        winner = winner, loser = loser,
        winner_score = ws, loser_score = ls,
        date = dt, round = rnd
      )))
    }
    message("    CBB hoopR: ", length(out2), " NCAA tournament games for ", season_yr)
    out2
  }, error = function(e) {
    message("    CBB hoopR failed (", e$message, ")")
    NULL
  })

  if (!is.null(games2)) games2 else list()
}

# ── Build series from games ─────────────────────────────────────────────────
build_series <- function(games, win_to_advance, sport="") {
  if (length(games) == 0) return(list(series = list(), eliminated = list()))

  # Group by (round, team_pair) — each unique pairing per round = one series
  groups <- list()
  for (g in games) {
    rnd <- tryCatch(g$round, error = function(e) "")
    if (is.null(rnd) || !nchar(rnd)) rnd <- "_unknown"
    pair_key <- paste(sort(c(g$winner, g$loser)), collapse = "|")
    key      <- paste(rnd, pair_key, sep = "||")
    if (is.null(groups[[key]])) groups[[key]] <- list(
      t1 = g$winner, t2 = g$loser, w1 = 0L, w2 = 0L,
      round = rnd, dates = c(), games = list()
    )
    if (groups[[key]]$t1 == g$winner) groups[[key]]$w1 <- groups[[key]]$w1 + 1L
    else                               groups[[key]]$w2 <- groups[[key]]$w2 + 1L
    dt <- tryCatch(g$date, error = function(e) "")
    if (nchar(dt) > 0) groups[[key]]$dates <- c(groups[[key]]$dates, dt)
  }

  all_series <- list(); all_elim <- c()
  for (key in names(groups)) {
    s     <- groups[[key]]
    # For MLB: Wild Card is best-of-3 (first to 2), DS best-of-5 (first to 3), CS/WS best-of-7
    rnd_wta <- win_to_advance
    if (sport == "MLB") {
      rn_low <- tolower(s$round)
      if (grepl("wild.?card|alwc|nlwc", rn_low)) rnd_wta <- 2L
      else if (grepl("alds|nlds|division", rn_low)) rnd_wta <- 3L
      else rnd_wta <- 4L
    }
    done  <- (s$w1 >= rnd_wta || s$w2 >= rnd_wta)
    loser <- if (done) (if (s$w1 < s$w2) s$t1 else s$t2) else ""
    if (done && nchar(loser) > 0) all_elim <- c(all_elim, loser)
    fd  <- if (length(s$dates) > 0) min(s$dates) else ""
    rn  <- if (s$round == "_unknown") "" else s$round
    all_series <- c(all_series, list(list(
      t1 = s$t1, t2 = s$t2, w1 = s$w1, w2 = s$w2,
      done = done, loser = loser, round = rn, date = fd
    )))
  }

  # Sort by date
  if (length(all_series) > 1) {
    dts        <- sapply(all_series, function(s) if (nchar(s$date) > 0) s$date else "9999")
    all_series <- all_series[order(dts)]
  }
  list(series = all_series, eliminated = as.list(unique(all_elim)))
}

# ── Write one JSON ──────────────────────────────────────────────────────────
write_tournament_json <- function(sport, season_yr, games_yr, out_dir,
                                  win_to_advance, start_mo, start_day,
                                  end_mo, end_day) {
  start <- as.Date(sprintf("%d-%02d-%02d", games_yr, start_mo, start_day))
  end   <- as.Date(sprintf("%d-%02d-%02d", games_yr, end_mo,   end_day))
  today <- Sys.Date()
  if (start > today) {
    message("    Skipping — not started yet"); return(invisible(NULL))
  }

  games <- if (sport == "CBB") {
    fetch_cbb_games(season_yr, start, min(end, today))
  } else {
    stypes <- if (sport == "NBA") c("3", "5") else c("3")
    fetch_scoreboard_games(
      switch(sport,
        NBA   = "basketball/nba",
        NHL   = "hockey/nhl",
        MLB   = "baseball/mlb",
        NFL   = "football/nfl",
        CBASE = "baseball/college-baseball"
      ),
      start, min(end, today), stypes
    )
  }

  built     <- build_series(games, win_to_advance)
  completed <- today > end

  result <- list(
    year = season_yr, sport = sport, completed = completed,
    games = games, series = built$series, eliminated = built$eliminated,
    updated = format(Sys.time(), "%Y-%m-%d %H:%M UTC")
  )
  out_file <- file.path(out_dir, paste0("tournament_", season_yr, ".json"))
  jsonlite::write_json(result, out_file, auto_unbox = TRUE, pretty = TRUE)
  message("    -> ", basename(out_file), " | ", length(games), " games | ",
          length(built$series), " series | completed=", completed)
}

# ── Configs ─────────────────────────────────────────────────────────────────
# Per-year date overrides for COVID/unusual seasons
get_dates <- function(sport, yr, games_yr) {
  # Default date ranges
  defaults <- list(
    NBA   = list(smo=4,  sdy=12, emo=6,  edy=30),
    NHL   = list(smo=4,  sdy=11, emo=7,  edy=15),
    MLB   = list(smo=10, sdy=1,  emo=11, edy=10),
    NFL   = list(smo=1,  sdy=11, emo=2,  edy=13),
    CBB   = list(smo=3,  sdy=14, emo=4,  edy=10),
    CBASE = list(smo=5,  sdy=28, emo=6,  edy=25)
  )
  d <- defaults[[sport]]

  # COVID/unusual overrides
  if (sport == "NBA" && yr == 2020) {
    # Bubble season: Jul 30 - Oct 11
    d$smo <- 7; d$sdy <- 30; d$emo <- 10; d$edy <- 15
  }
  if (sport == "NBA" && yr == 2021) {
    # Delayed season, playoffs May 22 - Jul 22
    d$smo <- 5; d$sdy <- 18; d$emo <- 7; d$edy <- 25
  }
  if (sport == "NHL" && games_yr == 2020) {
    # Bubble: Aug 1 - Sep 28
    d$smo <- 8; d$sdy <- 1; d$emo <- 9; d$edy <- 30
  }
  if (sport == "NHL" && games_yr == 2021) {
    # Delayed season: May 13 - Jul 7
    d$smo <- 5; d$sdy <- 13; d$emo <- 7; d$edy <- 10
  }
  if (sport == "MLB" && yr == 2020) {
    # 60-game season: playoffs Sep 29 - Oct 28
    d$smo <- 9; d$sdy <- 29; d$emo <- 10; d$edy <- 30
  }
  if (sport == "MLB" && yr == 2021) {
    # Wild Card added a third game: Oct 5-6 start
    d$smo <- 10; d$sdy <- 1; d$emo <- 11; d$edy <- 5
  }
  if (sport == "NFL" && games_yr == 2021) {
    # Extra wild card game added (14 teams): Jan 14-17
    d$smo <- 1; d$sdy <- 10; d$emo <- 2; d$edy <- 15
  }
  d
}

configs <- list(
  list(sport="NBA",   dir="docs/NBA/data",   win=4, seasons=2002:2026, off=0),
  list(sport="NHL",   dir="docs/NHL/data",   win=4, seasons=2013:2026, off=0),
  list(sport="MLB",   dir="docs/MLB/data",   win=3, seasons=2001:2026, off=0),
  list(sport="NFL",   dir="docs/NFL/data",   win=1, seasons=2001:2025, off=1),
  list(sport="CBB",   dir="docs/CBB/data",   win=1, seasons=2003:2026, off=0),
  list(sport="CBASE", dir="docs/CollegeBaseball/data", win=2, seasons=2018:2026, off=0)
)

# BUG FIX: write_tournament_json() had no error isolation at the call site,
# and configs is processed in order NBA -> NHL -> MLB -> NFL -> CBB -> CBASE
# (~90 sport/year iterations before CBB is even reached). A single uncaught
# error anywhere in that first ~90 iterations (a malformed date for an odd
# historical season, a write_json failure, etc.) would halt the whole script
# immediately — meaning CBB and CBASE, near the end of the queue, would
# silently never run at all, regardless of how correct their own logic is.
# Wrapping each iteration means one bad year/sport can never take down the
# rest of the run.
for (cfg in configs) {
  message("\n=== ", cfg$sport, " ===")
  dir.create(cfg$dir, showWarnings = FALSE, recursive = TRUE)
  for (yr in cfg$seasons) {
    games_yr <- yr + cfg$off
    dates <- get_dates(cfg$sport, yr, games_yr)
    message("  ", cfg$sport, " ", yr, " (games_yr=", games_yr, ")")
    tryCatch({
      write_tournament_json(
        sport = cfg$sport, season_yr = yr, games_yr = games_yr,
        out_dir = cfg$dir, win_to_advance = cfg$win,
        start_mo = dates$smo, start_day = dates$sdy,
        end_mo   = dates$emo, end_day   = dates$edy
      )
    }, error = function(e) {
      message("    ERROR (", cfg$sport, " ", yr, "): ", conditionMessage(e), " — continuing to next year")
    })
    Sys.sleep(0.25)
  }
}
message("\n=== Backfill complete ===")
