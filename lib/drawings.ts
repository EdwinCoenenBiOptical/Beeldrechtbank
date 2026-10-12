export const drawings = Array.from({length:12}, (_, i) => ({
 id: i+1, title: ['De zitting in beeld','Een moment in de rechtszaal','Portret tijdens de zitting','Luisteren naar het pleidooi','Aan het woord','De behandeling van de zaak','Blik op de rechtszaal','Voor de rechtbank','Tijdens het verhoor','De zitting hervat','Aan de verdediging','Een laatste verklaring'][i],
 preview: `/previews/drawing-${i+1}.jpg`, court: ['Utrecht','Rotterdam','Den Haag','Amsterdam'][i%4],
 date: `2022-03-${String(28-i*2).padStart(2,'0')}`, caseName: ['Voorbeeldzaak Noord','Voorbeeldzaak Park','Voorbeeldzaak Haven'][i%3],
 suspect: ['Verdachte A.','Verdachte B.','Verdachte C.'][i%3], lawyer: ['mr. Voorbeeld A','mr. Voorbeeld B','mr. Voorbeeld C'][i%3]
}));
