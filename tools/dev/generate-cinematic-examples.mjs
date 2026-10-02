import { writeFile, mkdir } from "node:fs/promises";
import { createCinematicFilm } from "./fixtures/cinematicFilm.mjs";
const directory = new URL("../../assets/json/demo-show/timeline-media/", import.meta.url);
await mkdir(directory, { recursive: true });
const film = createCinematicFilm();
for (const [id, scene] of Object.entries(film.scenes)) await writeFile(new URL(`cinematic-${id}.json`, directory), JSON.stringify({ ...scene, output: film.output }, null, 2) + "\n");
await writeFile(new URL("cinematic-film.json", directory), JSON.stringify(film, null, 2) + "\n");
await writeFile(new URL("cinematic-long-film.json", directory), JSON.stringify(createCinematicFilm({ duration: 300 }), null, 2) + "\n");
console.log("Generated five shot examples and two composition fixtures.");
