# ================================================================
# R/update_cbb.R  —  College Basketball Elo, 2003-current
# FIX: Conference lookup now uses `conference_competition == TRUE`
#      rows to build a team_id -> conference_name map.
#      For teams not in that map (non-power-conference), we use
#      groups_name from any game they appear in.
# ================================================================

suppressPackageStartupMessages({
  library(hoopR)
  library(dplyr)
  library(readr)
  library(lubridate)
})
source("R/elo_engine.R")
Sys.setenv(TZ = "America/New_York")

CURRENT_SEASON <- most_recent_mbb_season()
SEASONS        <- 2003:(CURRENT_SEASON + 1L)  # +1 catches next season if started
OUT_DIR        <- "docs/CBB/data"
dir.create(OUT_DIR, showWarnings = FALSE, recursive = TRUE)

get_cbb_season <- function(season) {
  message("  CBB ", season, "...")
  tryCatch({
    sched <- load_mbb_schedule(seasons = season) %>%
      mutate(date = as.Date(date)) %>%
      filter(
        home_id != away_id,
        !is.na(home_id), !is.na(away_id),
        !is.na(home_score), !is.na(away_score),
        as.numeric(home_score) != as.numeric(away_score),
        date <= Sys.Date()
      )
    if (nrow(sched) == 0) return(NULL)

    # ── Build team->conference map ─────────────────────────────
    # Use ALL rows with non-empty groups_name, not just conference_competition.
    # This covers many more teams since non-conf games also carry groups_name.
    # Priority: conference_competition games first, then any groups_name row.

    # Step 1: from conference games (most reliable)
    conf_rows <- sched %>%
      filter(isTRUE(conference_competition) | conference_competition == TRUE,
             !is.na(groups_name), trimws(groups_name) != "")

    # Step 2: from ANY game with groups_name (catches remaining teams)
    any_rows <- sched %>%
      filter(!is.na(groups_name), trimws(groups_name) != "",
             !grepl("^[0-9]+$", trimws(groups_name)))  # exclude numeric group IDs

    # Build maps: team_name -> conference
    build_map <- function(df) {
      if (nrow(df) == 0) return(character(0))
      home <- setNames(df$groups_name, df$home_short_display_name)
      away <- setNames(df$groups_name, df$away_short_display_name)
      both <- c(home, away)
      # Deduplicate: prefer the first assignment
      both[!duplicated(names(both))]
    }

    conf_map_priority <- build_map(conf_rows)
    conf_map_any      <- build_map(any_rows)

    # Merge: priority map wins, fill gaps with any_rows map
    all_names  <- unique(c(names(conf_map_priority), names(conf_map_any)))
    conf_map <- ifelse(
      !is.na(conf_map_priority[all_names]),
      conf_map_priority[all_names],
      conf_map_any[all_names]
    )
    names(conf_map) <- all_names
    conf_map <- conf_map[!is.na(names(conf_map)) & names(conf_map) != ""]

    # ── Build games ────────────────────────────────────────────
    games <- sched %>%
      mutate(
        home_pts   = as.numeric(home_score),
        away_pts   = as.numeric(away_score),
        winner     = if_else(home_pts > away_pts,
                             home_short_display_name, away_short_display_name),
        loser      = if_else(home_pts < away_pts,
                             home_short_display_name, away_short_display_name),
        winner_pts = pmax(home_pts, away_pts),
        loser_pts  = pmin(home_pts, away_pts)
      ) %>%
      filter(!is.na(winner), !is.na(loser), winner != loser) %>%
      select(winner, loser, winner_pts, loser_pts)

    if (nrow(games) == 0) return(NULL)

    list(games = games, conf_map = conf_map)
  }, error = function(e) { message("  ERROR: ", e$message); NULL })
}

for (s in SEASONS) {
  res <- get_cbb_season(s)
  if (is.null(res) || nrow(res$games) < 50) {
    message("  Skipping CBB ", s)
    next
  }
  elo <- run_elo(res$games, k=30, iters=10, min_games=4)
  elo <- attach_best_wins(elo, res$games)
  sos <- compute_sos(res$games, elo)

  # ── Conference tournament champion detection ──────────────
  # After conf tournaments end (early March), use actual champs for auto bids
  champs_raw <- tryCatch(
    fetch_conf_champs("basketball/mens-college-basketball", s, "&groups=50"),
    error = function(e) character(0)
  )
  # Build champ_map: team_name → TRUE
  # champs_raw is conf_name → team_shortDisplayName
  # We need to match to our canonical team names via conf_map
  conf_champ_map <- NULL
  if (length(champs_raw) > 0) {
    # Map shortDisplayName to canonical using existing conf_map
    all_teams <- names(res$conf_map)
    champ_teams <- character(0)
    for (team in champs_raw) {
      # Exact match first
      if (team %in% all_teams) {
        champ_teams <- c(champ_teams, team)
      } else {
        # Fuzzy: find closest match
        matched <- agrep(team, all_teams, ignore.case=TRUE, value=TRUE, max.distance=0.15)
        if (length(matched) > 0) champ_teams <- c(champ_teams, matched[1])
      }
    }
    if (length(champ_teams) > 0) {
      conf_champ_map <- setNames(rep(FALSE, length(all_teams)), all_teams)
      conf_champ_map[champ_teams] <- TRUE
      message("  Conf champs found: ", paste(champ_teams, collapse=", "))
    }
  }

  out <- build_output(elo, season=s, conf_map=res$conf_map, sos_map=sos,
                      conf_champ_map=conf_champ_map)
  write_csv(out, file.path(OUT_DIR, paste0("CBB_Elo_", s, ".csv")))
  message("  -> ", nrow(out), " teams, conf: ",
          sum(!is.na(out$conference)), "/", nrow(out),
          if (!is.null(conf_champ_map)) paste0(", champs: ", sum(out$conf_champ, na.rm=TRUE)) else "")
}


# ================================================================
# Write NCAA Tournament JSON (uses hoopR schedule data)
# ================================================================
write_cbb_tournament_json <- function(yr) {
  tryCatch({
    sched <- hoopR::load_mbb_schedule(seasons = yr)
    if (is.null(sched) || nrow(sched) == 0) {
      message("  No schedule data for ", yr); return(invisible(NULL))
    }
    
    # Tournament games: season_type = 3 (postseason) AND date in Mar-Apr
    # hoopR season_type can be character or integer
    tourn <- sched[
      !is.na(sched$season_type) & as.character(sched$season_type) == "3" &
      !is.na(sched$game_date) &
      format(as.Date(sched$game_date), "%m") %in% c("03","04") &
      !is.na(sched$home_score) & !is.na(sched$away_score),
    ]
    
    if (nrow(tourn) == 0) {
      message("  No tournament games found for ", yr); return(invisible(NULL))
    }
    

    
    # Build game list
    games <- list()
    seen  <- list()
    for (i in seq_len(nrow(tourn))) {
      row <- tourn[i,]
      hs <- suppressWarnings(as.numeric(row$home_score))
      as_ <- suppressWarnings(as.numeric(row$away_score))
      if (is.na(hs) || is.na(as_) || hs == as_) next
      
      hn <- tryCatch(as.character(row$home_team_name), error=function(e)
              tryCatch(as.character(row$home_short_display_name),error=function(e)""))
      an <- tryCatch(as.character(row$away_team_name), error=function(e)
              tryCatch(as.character(row$away_short_display_name),error=function(e)""))
      if (nchar(hn)==0 || nchar(an)==0) next
      
      dt <- tryCatch(as.character(as.Date(row$game_date)), error=function(e)"")
      
      # Deduplicate
      dk <- paste(hn, an, dt, sep="|")
      if (!is.null(seen[[dk]])) next; seen[[dk]] <- TRUE
      
      if (hs > as_) { winner <- hn; loser <- an; ws <- hs; ls <- as_ }
      else          { winner <- an; loser <- hn; ws <- as_; ls <- hs  }
      
      # Round name from notes_headline
      rnd <- tryCatch(as.character(row$notes_headline), error=function(e)"")
      if (is.null(rnd) || is.na(rnd)) rnd <- ""
      
      # Skip conference tournament games (they run late Feb / early Mar)
      # Conference tournament names contain conf name + "tournament" or "championship"
      # NCAA tournament games either have NCAA round names or blank notes
      if (nchar(rnd) > 0) {
        # If it has a round name, must be an NCAA tournament round
        ncaa_rounds <- c("First Four","First Round","Second Round",
                         "Sweet 16","Elite Eight","Final Four","Championship",
                         "Round of 64","Round of 32","Regional","National")
        conf_keywords <- c("Conference","Conference Tournament","A-10","ACC","SEC",
                          "Big Ten","Big 12","Pac-","American","Mountain West",
                          "Sun Belt","MAC","C-USA","MWC","AAC")
        is_ncaa <- any(sapply(ncaa_rounds, function(x) grepl(x, rnd, ignore.case=TRUE)))
        is_conf <- any(sapply(conf_keywords, function(x) grepl(x, rnd, fixed=TRUE)))
        if (!is_ncaa || is_conf) next
      }
      
      games <- c(games, list(list(
        winner=winner, loser=loser,
        winner_score=ws, loser_score=ls,
        date=dt, round=rnd
      )))
    }
    
    message("  CBB ", yr, ": ", length(games), " tournament games")
    if (length(games) == 0) return(invisible(NULL))
    
    # Build series (single-elimination: win=1)
    # Group by round
    round_groups <- list()
    for (g in games) {
      rn <- if(nchar(g$round)>0) g$round else "_"
      if (is.null(round_groups[[rn]])) round_groups[[rn]] <- list()
      round_groups[[rn]] <- c(round_groups[[rn]], list(g))
    }
    
    # Ordered round names for CBB
    round_order <- c("First Four","First Round","Round of 64","Second Round",
                     "Round of 32","Sweet 16","Elite Eight","Final Four","Championship")
    
    all_series <- list(); all_elim <- c()
    for (rn in names(round_groups)) {
      rg <- round_groups[[rn]]
      for (g in rg) {
        all_series <- c(all_series, list(list(
          t1=g$winner, t2=g$loser, w1=1L, w2=0L, done=TRUE,
          loser=g$loser, round=g$round, date=g$date
        )))
        all_elim <- c(all_elim, g$loser)
      }
    }
    
    # Sort series by round order then date
    if (length(all_series) > 1) {
      get_round_order <- function(rnd) {
        idx <- which(sapply(round_order, function(r) grepl(r, rnd, ignore.case=TRUE)))
        if (length(idx)) min(idx) else 99L
      }
      rord <- sapply(all_series, function(s) get_round_order(s$round))
      dord <- sapply(all_series, function(s) s$date)
      all_series <- all_series[order(rord, dord)]
    }
    
    today <- Sys.Date()
    completed <- today > as.Date(paste0(yr, "-04-10"))
    
    result <- list(
      year=yr, sport="CBB", completed=completed,
      games=games,
      series=all_series,
      eliminated=as.list(unique(all_elim)),
      updated=format(Sys.time(), "%Y-%m-%d %H:%M UTC")
    )
    
    out_dir  <- "docs/CBB/data"
    dir.create(out_dir, showWarnings=FALSE, recursive=TRUE)
    out_file <- file.path(out_dir, paste0("tournament_", yr, ".json"))
    jsonlite::write_json(result, out_file, auto_unbox=TRUE, pretty=TRUE)
    message("  Written: ", out_file)
  }, error=function(e) message("  CBB tournament error for ", yr, ": ", e$message))
}

# Run for all CBB seasons
for (s in SEASONS) {
  message("CBB tournament ", s, "...")
  write_cbb_tournament_json(s)
  Sys.sleep(0.3)
}
message("CBB tournament JSON done.")
