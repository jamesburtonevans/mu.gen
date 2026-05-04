import { constructHeader } from './header.js';
import { constructContent } from './content.js';
import { constructFooter } from './footer.js';

// select from index.html
const main = document.querySelector('main');

// import components
const header = constructHeader();
const content = constructContent();
const footer = constructFooter();

// append components to main
main.appendChild(header);
main.appendChild(content);
main.appendChild(footer);
