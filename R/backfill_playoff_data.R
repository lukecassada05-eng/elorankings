#!/usr/bin/env Rscript
# backfill_playoff_data.R
# Fetches all playoff/tournament data for every sport and year
# Writes docs/SPORT/data/tournament_YEAR.json
# YEAR = season year (NFL 2024 = season, playoffs Jan/Feb 2025)

suppressPackageStartupMessages({ library(jsonlite) })

# ── Skip non-playoff events ─────────────────────────────────────────────────
is_skip_event <- function(ev_name) {
  # Skip non-playoff events that appear in seasontype=3 feeds
  skip_exact <- c("nfl pro bowl","nba all-star","nhl all-star","mlb all-star",
                  "pro bowl","all-star game","skills competition","celebrity game",
                  "rising stars","draft combine","summer league")
  skip_any   <- c("exhibition","preseason","scrimmage")
  name_lower <- tolower(ev_name)
  any(sapply(skip_exact, function(w) grepl(w, name_lower, fixed=TRUE))) ||
  any(sapply(skip_any,   function(w) grepl(w, name_lower, fixed=TRUE)))
}

# ── Fetch individual game scores from ESPN scoreboard ─────────────────────
fetch_scoreboard_games <- function(sport_path, start_date, end_date,
                                   season_types=c("3")) {
  all_games <- list()
  seen      <- list()   # deduplication
  cur <- start_date

  while (cur <= end_date) {
    chunk_end <- min(end_date, as.Date(format(cur, "%Y-%m-01")) + 31)
    ds <- gsub("-","", as.character(cur))
    de <- gsub("-","", as.character(chunk_end))

    for (stype in season_types) {
      url <- paste0("https://site.api.espn.com/apis/site/v2/sports/",
                    sport_path, "/scoreboard?seasontype=", stype,
                    "&limit=500&dates=", ds, "-", de)
      data <- tryCatch(jsonlite::fromJSON(url, simplifyVector=FALSE),
                       error=function(e) NULL)
      if (is.null(data) || length(data$events)==0) next

      for (ev in data$events) {
        tryCatch({
          # Skip All-Star, Pro Bowl etc.
          ev_name <- tryCatch(ev$name, error=function(e) "")
          if (is_skip_event(ev_name)) next

          comp  <- ev$competitions[[1]]
          if (!isTRUE(comp$status$type$completed)) next
          comps <- comp$competitors
          if (length(comps) != 2) next
          scores <- suppressWarnings(as.numeric(sapply(comps, function(c) c$score)))
          names  <- sapply(comps, function(c) c$team$displayName)
          if (any(is.na(scores)) || scores[1]==scores[2] || any(nchar(names)==0)) next

          wi <- which.max(scores); li <- 3-wi
          dt <- tryCatch(substr(comp$date,1,10), error=function(e) "")

          # Deduplicate by winner+loser+date
          dup_key <- paste(names[wi], names[li], dt, sep="|")
          if (!is.null(seen[[dup_key]])) next
          seen[[dup_key]] <- TRUE

          # Round name: from notes or event type
          rnd <- ""
          notes <- tryCatch(comp$notes, error=function(e) NULL)
          if (!is.null(notes) && length(notes)>0)
            rnd <- tryCatch(notes[[1]]$headline, error=function(e) "")
          if (is.null(rnd)||nchar(rnd)==0)
            rnd <- if (stype=="5") "Play-In" else ""

          all_games <- c(all_games, list(list(
            winner=names[wi], loser=names[li],
            winner_score=scores[wi], loser_score=scores[li],
            date=dt, round=rnd
          )))
        }, error=function(e) NULL)
      }
      Sys.sleep(0.15)
    }
    cur <- chunk_end + 1
    Sys.sleep(0.1)
  }
  all_games
}

# ── CBB: use ESPN bracket API (much cleaner than scoreboard) ──────────────
fetch_cbb_games <- function(season_yr) {
  url <- paste0("https://site.api.espn.com/apis/site/v2/sports/basketball/",
                "mens-college-basketball/tournament/bracket?season=", season_yr)
  data <- tryCatch(jsonlite::fromJSON(url, simplifyVector=FALSE),
                   error=function(e) NULL)

  games <- list()

  if (!is.null(data)) {
    # Try different paths ESPN uses for bracket structure
    rounds <- tryCatch(data$bracket$rounds, error=function(e) NULL)
    if (is.null(rounds)) rounds <- tryCatch(data$rounds, error=function(e) NULL)
    if (is.null(rounds)) {
      # Try iterating top-level list
      for (nm in names(data)) {
        sub <- tryCatch(data[[nm]]$rounds, error=function(e) NULL)
        if (!is.null(sub)) { rounds <- sub; break }
      }
    }

    if (!is.null(rounds)) {
      round_names <- c("First Four","Round of 64","Round of 32",
                       "Sweet 16","Elite Eight","Final Four","Championship")
      for (ri in seq_along(rounds)) {
        rnd      <- rounds[[ri]]
        rnd_name <- tryCatch(rnd$name, error=function(e)
                    tryCatch(rnd$type$name, error=function(e)
                    if(ri<=length(round_names)) round_names[[ri]] else paste("Round",ri)))

        matchups <- tryCatch(rnd$matchups, error=function(e)
                    tryCatch(rnd$games, error=function(e) NULL))
        if (is.null(matchups)) next

        for (mu in matchups) {
          tryCatch({
            done <- isTRUE(tryCatch(mu$status$type$completed, error=function(e) FALSE))
            if (!done) next
            comps  <- mu$competitors
            if (is.null(comps)||length(comps)!=2) next
            scores <- suppressWarnings(as.numeric(sapply(comps, function(c)
              tryCatch(c$score, error=function(e) NA))))
            nms    <- sapply(comps, function(c)
              tryCatch(c$team$displayName, error=function(e)
              tryCatch(c$team$shortDisplayName, error=function(e) "")))
            if (any(is.na(scores))||any(nchar(nms)==0)||scores[1]==scores[2]) next
            wi <- which.max(scores); li <- 3-wi
            games <- c(games, list(list(
              winner=nms[wi], loser=nms[li],
              winner_score=scores[wi], loser_score=scores[li],
              date=tryCatch(substr(mu$date,1,10),error=function(e)""),
              round=rnd_name
            )))
          }, error=function(e) NULL)
        }
      }
      if (length(games)>0) {
        message("  CBB bracket API: ", length(games), " games")
        return(games)
      }
    }
  }

  # Fallback: scoreboard in 4-day chunks
  message("  CBB bracket API empty, using scoreboard fallback for ", season_yr)
  start <- as.Date(paste0(season_yr, "-03-14"))
  end   <- as.Date(paste0(season_yr, "-04-10"))
  today <- Sys.Date()
  if (start > today) return(list())
  end   <- min(end, today)

  seen2 <- list(); games2 <- list(); cur <- start
  while (cur <= end) {
    chunk_end <- min(end, cur + 3)
    ds <- gsub("-","", as.character(cur))
    de <- gsub("-","", as.character(chunk_end))
    url2 <- paste0("https://site.api.espn.com/apis/site/v2/sports/basketball/",
                   "mens-college-basketball/scoreboard?seasontype=3&limit=200&dates=",ds,"-",de)
    d2 <- tryCatch(jsonlite::fromJSON(url2,simplifyVector=FALSE),error=function(e)NULL)
    if (!is.null(d2)&&length(d2$events)>0) {
      for (ev in d2$events) {
        tryCatch({
          comp  <- ev$competitions[[1]]
          if (!isTRUE(comp$status$type$completed)) next
          comps <- comp$competitors
          if (length(comps)!=2) next
          scores <- suppressWarnings(as.numeric(sapply(comps,function(c)c$score)))
          nms    <- sapply(comps,function(c)c$team$displayName)
          if (any(is.na(scores))||scores[1]==scores[2]||any(nchar(nms)==0)) next
          wi <- which.max(scores); li <- 3-wi
          dt <- tryCatch(substr(comp$date,1,10),error=function(e)"")
          dk <- paste(nms[wi],nms[li],dt,sep="|")
          if (!is.null(seen2[[dk]])) next; seen2[[dk]] <- TRUE
          notes <- tryCatch(comp$notes[[1]]$headline,error=function(e)"")
          games2 <- c(games2,list(list(
            winner=nms[wi],loser=nms[li],
            winner_score=scores[wi],loser_score=scores[li],
            date=dt, round=if(!is.null(notes)&&nchar(notes)>0) notes else ""
          )))
        },error=function(e)NULL)
      }
    }
    cur <- chunk_end+1; Sys.sleep(0.15)
  }
  message("  CBB scoreboard fallback: ", length(games2), " games")
  games2
}

# ── Build series from game list ─────────────────────────────────────────────
build_series <- function(games, win_to_advance) {
  if (length(games)==0) return(list(series=list(), eliminated=list()))

  # Group games by round, build series within each round
  round_groups <- list()
  for (g in games) {
    rnd <- tryCatch(g$round, error=function(e) "")
    if (is.null(rnd)||length(rnd)==0||nchar(rnd)==0) rnd <- "_"
    if (is.null(round_groups[[rnd]])) round_groups[[rnd]] <- list()
    round_groups[[rnd]] <- c(round_groups[[rnd]], list(g))
  }

  all_series <- list(); all_elim <- c()
  for (rnd in names(round_groups)) {
    rg <- round_groups[[rnd]]
    pw <- list()
    for (g in rg) {
      key <- paste(sort(c(g$winner,g$loser)),collapse="|")
      if (is.null(pw[[key]])) pw[[key]] <- list(t1=g$winner,t2=g$loser,w1=0L,w2=0L,
                                                 round=rnd,dates=c())
      if (pw[[key]]$t1==g$winner) pw[[key]]$w1 <- pw[[key]]$w1+1L
      else                         pw[[key]]$w2 <- pw[[key]]$w2+1L
      dt <- tryCatch(g$date,error=function(e)"")
      if (nchar(dt)>0) pw[[key]]$dates <- c(pw[[key]]$dates,dt)
    }
    for (key in names(pw)) {
      s     <- pw[[key]]
      done  <- (s$w1>=win_to_advance || s$w2>=win_to_advance)
      loser <- if(done)(if(s$w1<s$w2)s$t1 else s$t2) else ""
      if (done&&nchar(loser)>0) all_elim <- c(all_elim,loser)
      fd    <- if(length(s$dates)>0) min(s$dates) else ""
      rn    <- if(s$round=="_") "" else s$round
      all_series <- c(all_series, list(list(
        t1=s$t1,t2=s$t2,w1=s$w1,w2=s$w2,done=done,loser=loser,round=rn,date=fd
      )))
    }
  }
  # Sort by date
  if (length(all_series)>1) {
    dts <- sapply(all_series, function(s) if(nchar(s$date)>0)s$date else "9999")
    all_series <- all_series[order(dts)]
  }
  list(series=all_series, eliminated=as.list(unique(all_elim)))
}

# ── Main: write tournament JSON for one sport/year ─────────────────────────
write_tournament_json <- function(sport, season_yr, games_yr, out_dir,
                                  win_to_advance, start_mo, start_day,
                                  end_mo, end_day) {
  start <- as.Date(sprintf("%d-%02d-%02d", games_yr, start_mo, start_day))
  end   <- as.Date(sprintf("%d-%02d-%02d", games_yr, end_mo, end_day))
  today <- Sys.Date()
  if (start > today) {
    message("  Skipping ", season_yr, " — not started yet")
    return(invisible(NULL))
  }
  fetch_end <- min(end, today)

  # Fetch games
  games <- if (sport == "CBB") {
    fetch_cbb_games(season_yr)
  } else {
    stypes <- if (sport=="NBA") c("3","5") else c("3")
    fetch_scoreboard_games(
      switch(sport,
        NBA="basketball/nba", NHL="hockey/nhl", MLB="baseball/mlb",
        NFL="football/nfl",   CBASE="baseball/college-baseball"),
      start, fetch_end, stypes
    )
  }

  built <- build_series(games, win_to_advance)
  completed <- today > end

  result <- list(
    year=season_yr, sport=sport, completed=completed,
    games=games, series=built$series, eliminated=built$eliminated,
    updated=format(Sys.time(), "%Y-%m-%d %H:%M UTC")
  )
  out_file <- file.path(out_dir, paste0("tournament_", season_yr, ".json"))
  jsonlite::write_json(result, out_file, auto_unbox=TRUE, pretty=TRUE)
  message("  ", out_file, " — ", length(games), " games, ",
          length(built$series), " series, completed=", completed)
}

# ── Config: all sports × all seasons ───────────────────────────────────────
configs <- list(
  list(sport="NBA",   dir="docs/NBA/data",   win=4,
       start_mo=4,  start_day=12, end_mo=6,  end_day=30,
       seasons=2002:2026, games_yr_offset=0),
  list(sport="NHL",   dir="docs/NHL/data",   win=4,
       start_mo=4,  start_day=11, end_mo=7,  end_day=15,
       seasons=2013:2026, games_yr_offset=0),
  list(sport="MLB",   dir="docs/MLB/data",   win=3,
       start_mo=10, start_day=1,  end_mo=11, end_day=10,
       seasons=2001:2026, games_yr_offset=0),
  list(sport="NFL",   dir="docs/NFL/data",   win=1,
       start_mo=1,  start_day=10, end_mo=2,  end_day=15,
       seasons=2001:2025, games_yr_offset=1),  # 2024 season → games Jan-Feb 2025
  list(sport="CBB",   dir="docs/CBB/data",   win=1,
       start_mo=3,  start_day=14, end_mo=4,  end_day=10,
       seasons=2003:2026, games_yr_offset=0),
  list(sport="CBASE", dir="docs/CollegeBaseball/data", win=2,
       start_mo=5,  start_day=28, end_mo=6,  end_day=25,
       seasons=2018:2026, games_yr_offset=0)
)

for (cfg in configs) {
  message("\n=== ", cfg$sport, " ===")
  dir.create(cfg$dir, showWarnings=FALSE, recursive=TRUE)
  for (yr in cfg$seasons) {
    games_yr <- yr + cfg$games_yr_offset
    message("  ", cfg$sport, " ", yr, " (games_yr=", games_yr, ")...")
    write_tournament_json(
      sport=cfg$sport, season_yr=yr, games_yr=games_yr,
      out_dir=cfg$dir, win_to_advance=cfg$win,
      start_mo=cfg$start_mo, start_day=cfg$start_day,
      end_mo=cfg$end_mo,   end_day=cfg$end_day
    )
    Sys.sleep(0.3)
  }
}
message("\n=== Backfill complete ===")
