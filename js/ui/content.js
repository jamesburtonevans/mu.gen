import { constructTransport } from './transport.js';
import { constructControls } from './controls.js';

export function constructContent() {
  const container = document.createElement("div");

  // define elements
  const transport = constructTransport();
  const controls = constructControls();
  // assign elements
  container.className = "content";

  // add elements to main container
  container.appendChild(controls);
  container.appendChild(transport);
  // return elements
  return container;
}
