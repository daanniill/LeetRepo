export async function clearLeetRepoStorage(storage) {
  const areas = [storage.local, storage.sync, storage.session].filter((area) => typeof area?.clear === "function");
  await Promise.all(areas.map((area) => area.clear()));
}
