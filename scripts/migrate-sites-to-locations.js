/**
 * One-time migration: flatten Site -> [Location] into a single flat Location
 * collection.
 *
 * Every location nested under a site becomes its own top-level `locations`
 * document, keeping its name and coordinates exactly as they are. Sites are
 * never used as a grouping again.
 *
 * Saved user schedule rows are deliberately NOT touched: each
 * `weeklyLocations.<day>` row already stores its own latitude/longitude
 * snapshot, so those rows keep working regardless of what happens here. The
 * script only *reports* which saved rows point at a name that will not exist
 * in the flat list, so nothing referenced is silently dropped.
 *
 * A site that has zero locations carries no coordinates of its own, so it gets
 * no flat entry by default. `--adopt-empty-site-coords` instead recovers its
 * coordinates from the saved user schedule rows that reference it, which keeps
 * a site that was selected directly (before it ever had locations under it)
 * selectable in the flat list.
 *
 * Usage:
 *   node scripts/migrate-sites-to-locations.js              # dry run (default)
 *   node scripts/migrate-sites-to-locations.js --apply      # write flat locations
 *   node scripts/migrate-sites-to-locations.js --apply --adopt-empty-site-coords
 *   node scripts/migrate-sites-to-locations.js --apply --drop-sites
 *
 * The old `sites` collection is left in place as a backup unless --drop-sites
 * is passed explicitly.
 */

import "dotenv/config";
import mongoose from "mongoose";

const APPLY = process.argv.includes("--apply");
const DROP_SITES = process.argv.includes("--drop-sites");
const ADOPT_EMPTY_SITE_COORDS = process.argv.includes("--adopt-empty-site-coords");

const DAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const coordinatesMatch = (a, b) =>
  Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-6;

const run = async () => {
  if (!process.env.MONGO_DB_URL) {
    throw new Error("MONGO_DB_URL is not set");
  }

  await mongoose.connect(process.env.MONGO_DB_URL);
  const db = mongoose.connection.db;
  console.log(`Connected to database "${db.databaseName}"`);
  console.log(APPLY ? "\nMODE: APPLY (writes)\n" : "\nMODE: DRY RUN (no writes)\n");

  const sites = await db.collection("sites").find({}).toArray();
  const existingFlat = await db.collection("locations").find({}).toArray();

  // ---- Before ----------------------------------------------------------
  const nestedLocationCount = sites.reduce(
    (total, site) => total + (site.locations?.length ?? 0),
    0
  );
  const emptySites = sites.filter((site) => (site.locations?.length ?? 0) === 0);

  console.log("BEFORE");
  console.log(`  sites:                       ${sites.length}`);
  console.log(`  locations nested in sites:   ${nestedLocationCount}`);
  console.log(`  sites with zero locations:   ${emptySites.length}`);
  console.log(`  existing flat locations:     ${existingFlat.length}`);
  console.log("");

  const users = await db
    .collection("users")
    .find({}, { projection: { name: 1, userId: 1, weeklyLocations: 1 } })
    .toArray();

  /**
   * Coordinates that saved schedule rows have recorded against a bare site
   * name. A site selected directly (when it had no locations under it) still
   * left its coordinates on every row that used it, so they are recoverable.
   */
  const coordsReferencedForSiteName = (siteName) => {
    const seen = [];

    for (const user of users) {
      for (const day of DAYS) {
        const row = user.weeklyLocations?.[day];
        if (!row || row.isWeekend) continue;
        if (String(row.site ?? "").trim() !== siteName) continue;
        if (String(row.locationName ?? "").trim()) continue;

        const latitude = Number(row.latitude);
        const longitude = Number(row.longitude);
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;

        const match = seen.find(
          (entry) =>
            coordinatesMatch(entry.latitude, latitude) &&
            coordinatesMatch(entry.longitude, longitude)
        );

        if (match) match.rows += 1;
        else seen.push({ latitude, longitude, rows: 1 });
      }
    }

    return seen.sort((a, b) => b.rows - a.rows);
  };

  // ---- Flatten ---------------------------------------------------------
  const byName = new Map(existingFlat.map((doc) => [doc.name, doc]));
  const toInsert = [];
  const renamed = [];
  const skippedAsDuplicate = [];
  const now = new Date();

  for (const site of sites) {
    for (const location of site.locations ?? []) {
      const originalName = String(location.name ?? "").trim();
      const latitude = Number(location.latitude);
      const longitude = Number(location.longitude);

      if (!originalName || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        console.warn(
          `  ! skipping malformed location under "${site.name}":`,
          JSON.stringify(location)
        );
        continue;
      }

      const clash = byName.get(originalName);
      let name = originalName;

      if (clash) {
        if (
          coordinatesMatch(clash.latitude, latitude) &&
          coordinatesMatch(clash.longitude, longitude)
        ) {
          // Same name, same spot: it is the same place listed twice. Keeping one
          // entry loses no coordinate data.
          skippedAsDuplicate.push(`${originalName} (from site "${site.name}")`);
          continue;
        }

        // Same name, different coordinates: both are real places, so neither may
        // be dropped. Disambiguate with the old site name.
        name = `${originalName} (${site.name})`;
        let suffix = 2;
        while (byName.has(name)) {
          name = `${originalName} (${site.name} ${suffix})`;
          suffix += 1;
        }
        renamed.push({ from: originalName, to: name, site: site.name });
      }

      const doc = {
        name,
        latitude,
        longitude,
        createdAt: location.createdAt ?? site.createdAt ?? now,
        updatedAt: location.updatedAt ?? site.updatedAt ?? now,
      };

      byName.set(name, doc);
      toInsert.push(doc);
    }
  }

  // ---- Empty sites: recover coordinates from the rows that used them ----
  const adoptedEmptySites = [];
  const ambiguousEmptySites = [];

  if (ADOPT_EMPTY_SITE_COORDS) {
    for (const site of emptySites) {
      if (byName.has(site.name)) continue;

      const candidates = coordsReferencedForSiteName(site.name);
      if (candidates.length === 0) continue;

      if (candidates.length > 1) {
        // More than one distinct point was saved under this name; picking one
        // would be a guess, so leave it out and say so.
        ambiguousEmptySites.push({ site: site.name, candidates });
        continue;
      }

      const [{ latitude, longitude, rows }] = candidates;
      const doc = {
        name: site.name,
        latitude,
        longitude,
        createdAt: site.createdAt ?? now,
        updatedAt: site.updatedAt ?? now,
      };

      byName.set(site.name, doc);
      toInsert.push(doc);
      adoptedEmptySites.push({ site: site.name, latitude, longitude, rows });
    }
  }

  // ---- Report on saved user schedule references ------------------------
  const unresolvedRefs = new Map();

  for (const user of users) {
    for (const day of DAYS) {
      const row = user.weeklyLocations?.[day];
      if (!row || row.isWeekend) continue;

      // Rows saved before locations were tracked by name only carry `site`.
      const referenced = String(row.locationName || row.site || "").trim();
      if (!referenced || byName.has(referenced)) continue;

      // A row with no `locationName` may still be resolvable by coordinates.
      const matchesByCoordinates = [...byName.values()].some(
        (candidate) =>
          coordinatesMatch(candidate.latitude, Number(row.latitude)) &&
          coordinatesMatch(candidate.longitude, Number(row.longitude))
      );
      if (!row.locationName && matchesByCoordinates) continue;

      const key = referenced;
      if (!unresolvedRefs.has(key)) unresolvedRefs.set(key, []);
      unresolvedRefs
        .get(key)
        .push(`${user.name ?? "?"} (${user.userId ?? user._id}) · ${day}`);
    }
  }

  // ---- Write -----------------------------------------------------------
  if (APPLY && toInsert.length > 0) {
    await db.collection("locations").insertMany(toInsert);
    await db.collection("locations").createIndex({ name: 1 }, { unique: true });
  }

  if (APPLY && DROP_SITES) {
    await db.collection("sites").drop();
    console.log('  dropped the old "sites" collection\n');
  }

  const flatAfter = APPLY
    ? await db.collection("locations").countDocuments()
    : existingFlat.length + toInsert.length;

  // ---- After -----------------------------------------------------------
  console.log("AFTER");
  console.log(`  flat locations:              ${flatAfter}`);
  console.log(
    `  = ${existingFlat.length} existing + ${toInsert.length - adoptedEmptySites.length} migrated` +
      (adoptedEmptySites.length
        ? ` + ${adoptedEmptySites.length} recovered from empty site(s)`
        : "") +
      (skippedAsDuplicate.length
        ? ` (${skippedAsDuplicate.length} exact duplicate(s) collapsed)`
        : "")
  );
  console.log("");

  const accountedFor =
    toInsert.length - adoptedEmptySites.length + skippedAsDuplicate.length;
  if (accountedFor === nestedLocationCount) {
    console.log(
      `✓ All ${nestedLocationCount} nested location(s) accounted for — no coordinate data lost.`
    );
  } else {
    console.log(
      `✗ MISMATCH: ${nestedLocationCount} nested location(s) in, ${accountedFor} accounted for.`
    );
  }

  if (renamed.length > 0) {
    console.log("\nRenamed to avoid a flat-list name clash:");
    for (const entry of renamed) {
      console.log(`  "${entry.from}" -> "${entry.to}"`);
    }
  }

  if (skippedAsDuplicate.length > 0) {
    console.log("\nCollapsed (identical name AND coordinates):");
    for (const entry of skippedAsDuplicate) console.log(`  ${entry}`);
  }

  if (adoptedEmptySites.length > 0) {
    console.log(
      "\nEmpty sites given a flat entry from the coordinates their schedule rows carried:"
    );
    for (const entry of adoptedEmptySites) {
      console.log(
        `  "${entry.site}" -> ${entry.latitude}, ${entry.longitude} (from ${entry.rows} saved row(s))`
      );
    }
  }

  if (ambiguousEmptySites.length > 0) {
    console.log(
      "\n! Empty sites with MORE THAN ONE distinct saved coordinate — no entry created,"
    );
    console.log("  because choosing one would be a guess:");
    for (const entry of ambiguousEmptySites) {
      console.log(`  "${entry.site}"`);
      for (const candidate of entry.candidates) {
        console.log(
          `      ${candidate.latitude}, ${candidate.longitude} (${candidate.rows} row(s))`
        );
      }
    }
  }

  const unadoptedEmptySites = emptySites.filter(
    (site) => !adoptedEmptySites.some((entry) => entry.site === site.name)
  );

  if (unadoptedEmptySites.length > 0) {
    console.log(
      "\nSites with zero locations (no coordinates to carry over, so no flat entry created):"
    );
    for (const site of unadoptedEmptySites) {
      const refs = unresolvedRefs.get(site.name) ?? [];
      console.log(
        `  "${site.name}" — ${refs.length === 0 ? "not referenced by any user schedule" : `REFERENCED by ${refs.length} schedule row(s)`}`
      );
      for (const ref of refs) console.log(`      ${ref}`);
    }
  }

  if (unresolvedRefs.size > 0) {
    console.log(
      "\nSaved schedule rows pointing at a name that is not in the flat list."
    );
    console.log(
      "  Their own saved lat/lng are untouched and still display; the dropdown"
    );
    console.log('  shows them as "<name> (unavailable)".');
    for (const [name, refs] of unresolvedRefs) {
      console.log(`  "${name}" — ${refs.length} row(s)`);
    }
  }

  if (!APPLY) {
    console.log("\nDry run only. Re-run with --apply to write these changes.");
  }

  await mongoose.disconnect();
};

run().catch(async (error) => {
  console.error("Migration failed:", error);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
