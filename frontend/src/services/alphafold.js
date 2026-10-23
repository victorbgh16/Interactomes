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
        paeDocUrl: entry.paeDocUrl,
        requestUrl: url,

    };
  } catch (error) {
    console.error("AlphaFold fetch error:", error.message);
  }
}

// TODO: probably need to pass the threshold here too
export async function getOrGeneratePaeImage(uniprotId, cifUrl, paeDocUrl, crosslinks) {
  try {
    const response = await fetch(`http://localhost:3001/api/proteins/${uniprotId}/pae`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        cifUrl,
        paeDocUrl,
        crosslinks
      })
    });

    if (!response.ok) throw new Error('Failed to fetch PAE image');
    
    const data = await response.json();
    return data.paeImagePath;
  } catch (err) {
    console.error(err);
    return null;
  }
}