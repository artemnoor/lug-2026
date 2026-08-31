const params = new URLSearchParams(location.search);
const target = new URL("index.html", location.href);
["action", "invite", "next"].forEach((key) => {
  if (params.has(key)) target.searchParams.set(key, params.get(key));
});
if (!target.searchParams.has("action") && !target.searchParams.has("invite") && !target.searchParams.has("next")) target.searchParams.set("action", "choice");
location.replace(target.href);
