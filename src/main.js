import { createEngine } from "./engine/engine.js";
import { createWebOutput } from "./platform/web.js";
import { mountApp } from "./ui/app.js";
import "./ui/style.css";

const engine = createEngine();
const output = createWebOutput(engine.context);

async function start() {
  // output.open() must run before any await in the click
  const playing = output.open();
  engine.output.connect(output.node);
  await engine.start();
  await playing;
  output.setMetadata({ title: "mu.gen", artist: "generative" });
}

function stop() {
  engine.stop();
  engine.output.disconnect();
  output.close();
}

mountApp(document.querySelector("main"), {
  store: engine.store,
  onStart: start,
  onStop: stop,
  onParam: engine.setParam,
});
