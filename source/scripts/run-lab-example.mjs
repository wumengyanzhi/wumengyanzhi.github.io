import { createServer } from 'vite';
import fs from 'node:fs/promises';
const server=await createServer({server:{middlewareMode:true},appType:'custom'});
try{
  const {runExample}=await server.ssrLoadModule('/src/lab/example.ts');
  await fs.mkdir('artifacts/lab',{recursive:true});await fs.mkdir('docs/数值实验室/实测',{recursive:true});
  for(const split of ['exploration','holdout']){
    const result=await runExample(split,100);
    await fs.writeFile(`artifacts/lab/${split}.experiment.json`,result.pack);
    await fs.writeFile(`artifacts/lab/${split}.csv`,result.csv);
    await fs.writeFile(`docs/数值实验室/实测/2026-10-09-${split}.md`,result.markdown);
    await fs.writeFile(`docs/数值实验室/实测/2026-10-09-${split}.json`,JSON.stringify(result.summary,null,2));
    console.log(JSON.stringify(result.summary));
  }
}finally{await server.close();}
