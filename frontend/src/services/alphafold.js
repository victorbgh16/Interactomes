export async function fetchAlphafoldData(uniprotId) {
  if (!uniprotId) {
    console.warn("No UniProt ID provided.");
    return;
  }

  const url = `https://alphafold.ebi.ac.uk/api/prediction/${uniprotId}?include_complexes=false`;
  console.log("Requesting URL:", url);
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Response status: ${response.status}`);
    }

    const data = await response.json();
    // console.log("AlphaFold JSON Response:", result);
    
    const entry = data[0];
    if (!entry) return null;

    return {
        entryId: entry.entryId,
        cifUrl: entry.cifUrl,
        meanPlddt: entry.globalMetricValue,
        paeImgUrl: entry.paeImageUrl,
        paeJsonUrl: entry.paeDocUrl,
        requestUrl: url,

    };
  } catch (error) {
    console.error("AlphaFold fetch error:", error.message);
  }
}