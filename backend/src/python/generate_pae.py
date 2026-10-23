import json
import urllib.request
import numpy as np
from Bio.PDB import MMCIFParser
import matplotlib.pyplot as plt
import os
import sys

def generate_pae(uniprot_id, cif_url, pae_json_url, crosslinks_json_str, output_path, threshold=35.0):
    # 1. Download PAE JSON matrix
    with urllib.request.urlopen(pae_json_url) as response:
        pae_data = json.loads(response.read().decode())

    # Import PAE JSON into a numpy array
    pae_matrix = np.array(pae_data[0]['predicted_aligned_error'])

    # 2. Download the CIF file and set up parser
    cif_file = f"{uniprot_id}.cif"
    urllib.request.urlretrieve(cif_url, cif_file)
    parser = MMCIFParser(QUIET=True)
    structure = parser.get_structure(uniprot_id, cif_file)
    residues = list(structure.get_residues())

    # 3. Get C-alpha coordinates
    ca_coords = {}
    for res in residues:
        if 'CA' in res:
            pos = res.id[1] # Residue sequence number
            ca_coords[pos] = res['CA'].get_coord()

    # 4. Set up comparison
    # Parse crosslinks passed from Node
    all_crosslinks = json.loads(crosslinks_json_str)

    # Filter for only intraprotein crosslinks
    crosslinks = [
        cl for cl in all_crosslinks
        if cl['Protein1'] == uniprot_id and cl['Protein2'] == uniprot_id
    ]

    satisfied_x, satisfied_y = [], []
    violated_x, violated_y = [], []
    threshold = threshold

    # 5. Compute Euclidean distances (in Angstrom) and compare
    for cl in crosslinks:
        p1, p2 = cl['AbsPos1'], cl['AbsPos2']
        if p1 in ca_coords and p2 in ca_coords:
            dist = np.linalg.norm(ca_coords[p1] - ca_coords[p2])

            # PAE matrix coords -> indexed from 0, symmetric matrix
            x_idx, y_idx = p2 - 1, p1 - 1

            if dist <= threshold:
                satisfied_x.extend([x_idx, y_idx])
                satisfied_y.extend([y_idx, x_idx])
            else:
                violated_x.extend([x_idx, y_idx])
                violated_y.extend([y_idx, x_idx])

    # 6. Plot the PAE and overlay crosslink satisfaction
    plt.rcParams.update({
        'text.color': 'white',
        'axes.labelcolor': 'white',
        'xtick.color': 'white',
        'ytick.color': 'white',
        'axes.edgecolor': 'white'
    })
    fig, ax = plt.subplots(figsize=(7, 8), dpi=300)
    im = ax.imshow(pae_matrix, cmap='Blues_r', vmin=0, vmax=30)

    if satisfied_x:
        ax.scatter(satisfied_x, satisfied_y, c='limegreen', s=10, label=r'Satisfied ($\leq$' + str(threshold) + 'Å)')
    if violated_x:
        ax.scatter(violated_x, violated_y, c='crimson', s=18, marker='x', label=r'Violated ($>$' + str(threshold) + 'Å)')

    ax.set_title(f"PAE and Crosslinks for {uniprot_id}", fontsize=10, color='white')
    ax.set_xlabel('Scored Residue')
    ax.set_ylabel('Aligned Residue')
    cbar = fig.colorbar(im, ax=ax, orientation='horizontal', fraction=0.045, pad=0.1, shrink=0.7)
    cbar.set_label('Expected Position Error (Å)', color='white')
    cbar.ax.tick_params(colors='white')
    # plt.legend(loc='upper right', framealpha=0.8, fontsize=8)
    ax.legend(loc='upper center', bbox_to_anchor=(0.5, -0.25), ncol=2, framealpha=0.3, facecolor='#111', edgecolor='white', fontsize=8)

    # 7. Save the finished image file (for testing comment out plt.savefig and comment in plt.show)
    dir_name = os.path.dirname(output_path)
    if dir_name:
        os.makedirs(os.path.dirname(output_path), exist_ok=True)

    plt.savefig(output_path, bbox_inches='tight', transparent=True)
    # plt.show()
    plt.close()

    # 8. Clean up CIF file
    if os.path.exists(cif_file):
        os.remove(cif_file)

if __name__ == "__main__":
    generate_pae(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])
    # change back to also include sys.argv[6] when threshold is set up