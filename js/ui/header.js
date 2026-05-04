export function constructHeader() {
  const container = document.createElement("div");

  // define elements
  const title = document.createElement("h1");
  const logo = document.createElement("div");
  const logoImg = document.createElement("img");

  const divider = document.createElement("div");

  const signIn = document.createElement("button");

  // assign elements
  container.className = "header";
  title.className = "title";
  title.textContent = "mu.gen";
  logo.className = "logo";
  logoImg.src = "../assets/images/mu-gen_logo.png";
  divider.className = "divider";
  signIn.className = "btn-sign-in";
  signIn.textContent = "Sign In";

  // add elements to main container
  logo.appendChild(logoImg);
  container.appendChild(logo);
  container.appendChild(title);
  container.appendChild(divider);
  container.appendChild(signIn);

  // return elements
  return container;
}
