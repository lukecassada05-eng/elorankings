#!/usr/bin/env Rscript
# ================================================================
# R/update_current_standings.R
#
# Orchestrator for the "real standings and tiebreakers" feature. For NBA,
# NHL, MLB, NFL: reads the current season's already-written <SPORT>_Elo_<yr>.csv
# (team roster + division, via its `conference` column — see the note in
# R/standings_engine.R about that column actually holding the division) and
# <SPORT>_Games_<yr>.csv game log (written by each update_<sport>.R as of
# this feature), computes real won-loss/points records, division standings,
# and a playoff-field/seeding projection using each league's actual
# tiebreaker rules (R/standings_engine.R), and merges the result into that
# season's tournament_<yr>.json as two new keys — `standings` (division
# tables) and `current_field` (conference/league seeding) — alongside
# whatever real postseason `games`/`series`/`eliminated` data
# backfill_playoff_data.R has already written there (never overwritten).
#
# This is a "if the season ended today" snapshot, not a final bracket —
# real seeding is only final once the regular season actually ends. See
# the HONESTY NOTE at the top of R/standings_engine.R for exactly which
# steps of each league's tiebreaker procedure are genuinely computed here
# vs. where this engine falls back to Elo (same disclosed-approximation
# pattern as the CFB playoff-chance feature).
# ================================================================

suppressPackageStartupMessages({
  library(readr)
  library(jsonlite)
})
source("R/elo_engine.R")
source("R/standings_engine.R")

# ── Locate the current season's Elo + Games CSVs for one sport ─────────
# Picks the highest season year that has BOTH an Elo CSV and a Games CSV on
# disk. A "next season" Elo CSV that some update_<sport>.R scripts pre-stage
# before any games are played never gets a Games CSV written (each script's
# own too-few-games guard `next`s out before reaching the games-log write),
# so it's naturally skipped here without any extra date-math duplicated
# from those scripts.
latest_season_files <- function(dir, sport) {
  if (!dir.exists(dir)) return(NULL)
  pat <- paste0("^", sport, "_Elo_([0-9]{4})\\.csv$")
  elo_files <- list.files(dir, pattern = pat)
  if (!length(elo_files)) {
    message("  No ", sport, "_Elo_*.csv found in ", dir, " — nothing to do yet.")
    return(NULL)
  }
  yrs <- as.integer(sub(pat, "\\1", elo_files))
  for (yr in sort(yrs, decreasing = TRUE)) {
    games_path <- file.path(dir, paste0(sport, "_Games_", yr, ".csv"))
    if (file.exists(games_path)) {
      return(list(year = yr,
                  elo_path   = file.path(dir, paste0(sport, "_Elo_", yr, ".csv")),
                  games_path = games_path))
    }
  }
  message("  Found ", sport, " Elo CSV(s) but no matching Games CSV yet — ",
          "update_", tolower(sport), ".R needs to run at least once after ",
          "this feature was added before standings can be computed.")
  NULL
}

# ── Build a division-by-division standings table (for display) ─────────
division_table <- function(records, team_div, sport, crit, elo_lookup, primary) {
  divs <- unique(stats::na.omit(unname(team_div)))
  out <- list()
  for (dv in divs) {
    teams <- names(team_div)[!is.na(team_div) & team_div == dv]
    teams <- intersect(teams, rownames(records))
    if (!length(teams)) next
    ord <- .rank_group(teams, records, crit, elo_lookup, primary = primary)
    rows <- lapply(seq_along(ord), function(i) {
      t <- ord[i]
      row <- list(team = t, rank = i,
                  wins = unname(records[t, "wins"]), losses = unname(records[t, "losses"]),
                  win_pct = round(unname(records[t, "win_pct"]), 3))
      if (sport == "NHL") {
        row$points <- unname(records[t, "points"])
        row$points_pct <- round(unname(records[t, "points_pct"]), 3)
      }
      row
    })
    out[[dv]] <- rows
  }
  out
}

# ── Merge current_field + standings into tournament_<yr>.json ──────────
merge_current_field <- function(out_dir, season_yr, sport, field_df, standings_tbl) {
  dir.create(out_dir, showWarnings = FALSE, recursive = TRUE)
  out_file <- file.path(out_dir, paste0("tournament_", season_yr, ".json"))
  prev <- if (file.exists(out_file)) {
    tryCatch(jsonlite::fromJSON(out_file, simplifyVector = FALSE), error = function(e) NULL)
  } else NULL
  result <- if (!is.null(prev)) prev else list(
    year = season_yr, sport = sport, completed = FALSE,
    games = list(), series = list(), eliminated = list()
  )
  result$current_field <- if (is.null(field_df) || !nrow(field_df)) {
    list()
  } else {
    lapply(seq_len(nrow(field_df)), function(i) as.list(field_df[i, ]))
  }
  result$standings <- standings_tbl
  result$current_field_updated <- format(Sys.time(), "%Y-%m-%d %H:%M UTC")
  jsonlite::write_json(result, out_file, auto_unbox = TRUE, pretty = TRUE, na = "null")
  message("  -> merged current_field (", nrow(if(is.null(field_df)) data.frame() else field_df),
          " rows) + standings into ", basename(out_file))
}

process_sport <- function(sport, dir, seed_fn, criteria_fn, primary) {
  message("\n=== ", sport, " current standings ===")
  loc <- latest_season_files(dir, sport)
  if (is.null(loc)) return(invisible(NULL))

  elo <- tryCatch(readr::read_csv(loc$elo_path, show_col_types = FALSE), error = function(e) NULL)
  games <- tryCatch(readr::read_csv(loc$games_path, show_col_types = FALSE), error = function(e) NULL)
  if (is.null(elo) || !nrow(elo) || is.null(games)) {
    message("  Couldn't read Elo/Games CSVs for ", sport, " ", loc$year, " — skipping")
    return(invisible(NULL))
  }
  games <- as.data.frame(games)
  # Games log needs real values in winner/loser (tiebreaker criteria index
  # into it by team name) — drop any malformed rows defensively.
  games <- games[!is.na(games$winner) & !is.na(games$loser) & nchar(games$winner) > 0 & nchar(games$loser) > 0, ]

  all_teams  <- unique(elo$team)
  team_div   <- setNames(elo$conference, elo$team)
  elo_lookup <- setNames(elo$elo, elo$team)

  records <- build_records(sport, games, all_teams)

  field <- tryCatch(seed_fn(records, team_div, games, elo_lookup), error = function(e) {
    message("  ERROR building playoff field for ", sport, ": ", conditionMessage(e))
    NULL
  })

  crit <- tryCatch(criteria_fn(games, records, team_div), error = function(e) list())
  standings <- tryCatch(division_table(records, team_div, sport, crit, elo_lookup, primary),
                        error = function(e) {
                          message("  ERROR building standings table for ", sport, ": ", conditionMessage(e))
                          list()
                        })

  merge_current_field(dir, loc$year, sport, field, standings)
}

# process_sport()'s generic criteria_fn always gets called as
# criteria_fn(games, records, team_div) — small wrappers adapt the two
# sports whose criteria builders (standings_engine.R) don't take exactly
# that signature (NHL doesn't need team_div at all; NFL additionally needs
# a full-league win% vector for strength of victory/schedule).
nhl_crit_wrap <- function(games, records, team_div) nhl_criteria(games, records)
nfl_div_crit_wrap <- function(games, records, team_div) {
  all_win_pct <- setNames(records$win_pct, rownames(records))
  nfl_division_criteria(games, records, team_div, all_win_pct)
}

process_sport("NBA", "docs/NBA/data", seed_nba, nba_criteria, primary = "win_pct")
process_sport("NHL", "docs/NHL/data", seed_nhl, nhl_crit_wrap, primary = "points_pct")
process_sport("MLB", "docs/MLB/data", seed_mlb, mlb_criteria, primary = "win_pct")
process_sport("NFL", "docs/NFL/data", seed_nfl, nfl_div_crit_wrap, primary = "win_pct")

message("\n=== Current standings update complete ===")
