(function () {
    'use strict';

    const round=(v,d=2)=>{const p=Math.pow(10,d);return Math.round(v*p)/p;};
    const mmToIn=(mm)=>mm/25.4;
    const MATERIAL_DB={
        "Aluminum 6061":{chipload_mm_min:0.02,chipload_mm_max:0.05,sfm_min:250,sfm_max:800,note:"Free-milling aluminum. Loves sharp tools, air blast, light mist."},
        "Aluminum 7075":{chipload_mm_min:0.018,chipload_mm_max:0.045,sfm_min:200,sfm_max:700,note:"Stronger alloy. Slightly lower SFM vs 6061."},
        "Brass":{chipload_mm_min:0.015,chipload_mm_max:0.04,sfm_min:200,sfm_max:600,note:"Rigid, chips nicely. Watch for chatter; reduce WOC if it sings."},
        "Copper":{chipload_mm_min:0.015,chipload_mm_max:0.035,sfm_min:150,sfm_max:500,note:"Gummy—needs sharp tools and good chip evacuation."},
        "Mild Steel 1018":{chipload_mm_min:0.01,chipload_mm_max:0.03,sfm_min:60,sfm_max:200,note:"Challenging on light routers. Prefer small WOC, flood/mist if possible."},
        "Delrin":{chipload_mm_min:0.03,chipload_mm_max:0.08,sfm_min:200,sfm_max:1000,note:"Machines beautifully. Air blast to clear strings."},
        "Acrylic":{chipload_mm_min:0.03,chipload_mm_max:0.07,sfm_min:150,sfm_max:800,note:"Prevent melting: keep chips thick, RPM moderate, feed steady."},
        // Wood chiploads: Freud's solid-carbide router bit chart, 1/8" row, converted to mm.
        // Wood is banded by rpm, not SFM: Leitz gives 50–90 m/s for wood, far beyond what a
        // shank bit on a 24k spindle reaches, so charts (Freud, Onsrud) start at 18,000 rpm
        // and Onsrud's method lowers rpm from there until the finish suffers.
        "Softwood":{chipload_mm_min:0.10,chipload_mm_max:0.15,rpm_min:12000,rpm_max:18000,note:"Pine, spruce, fir, cedar. Tears and fuzzes with a dull edge or a thin chip; keep the tool sharp and the chips big."},
        "Hardwood":{chipload_mm_min:0.05,chipload_mm_max:0.13,rpm_min:12000,rpm_max:18000,note:"Oak, maple, cherry, walnut. Too slow a feed burns it, cherry and maple first."},
        "Plywood":{chipload_mm_min:0.075,chipload_mm_max:0.13,rpm_min:12000,rpm_max:18000,note:"Glue lines are abrasive—use carbide. Downcut or compression bits keep the face veneer from tearing out."}
    };
    function diameterScaleFactor(d){ if(d<=3.5)return 1.0; if(d<=6.5)return 1.6; if(d<=8.5)return 1.9; return 2.4; }
    function suggestionDocWoc(op,rig){
      const isRigid = rig === "Rigid CNC";
      if (op === "Slotting") {
        return { doc: isRigid ? 0.5 : 0.2, woc: 1.0 };
      }
      if (op === "Boring") {
        // Circular interpolation / boring: light radial engagement, modest axial step
        return { doc: isRigid ? 0.3 : 0.15, woc: isRigid ? 0.1 : 0.05 };
      }
      // Side Milling (default)
      return { doc: isRigid ? 1.0 : 0.5, woc: isRigid ? 0.4 : 0.2 };
    }

    let units="Metric";
    function q(id){return document.getElementById(id);}
    const els={material:q('material'),toolMaterial:q('toolMaterial'),diamMm:q('diamMm'),flutes:q('flutes'),
        rigidity:q('rigidity'),operation:q('operation'),rpm:q('rpm'),aggr:q('aggr'),
        rpmPill:q('rpmPill'),aggrPill:q('aggrPill'),
        chiploadOut:q('chiploadOut'),feedOut:q('feedOut'),sfmOut:q('sfmOut'),sfmBand:q('sfmBand'),
        rpmSuggest:q('rpmSuggest'),docOut:q('docOut'),wocOut:q('wocOut'),wocSub:q('wocSub'),
        ctxMaterial:q('ctxMaterial'),ctxMatNote:q('ctxMatNote'),ctxTool:q('ctxTool'),
        ctxMachine:q('ctxMachine'),ctxOp:q('ctxOp'),notesList:q('notesList'),
        quickDia:q('quickDia'),btnMetric:q('btnMetric'),btnImperial:q('btnImperial')};

    // populate selects & quick dia
    Object.keys(MATERIAL_DB).forEach(m=>{const o=document.createElement('option');o.value=m;o.textContent=m;els.material.appendChild(o);});
    [3.175,4,6,8,10,12].forEach(d=>{
        const b=document.createElement('button');
        b.type='button';
        b.className='chip';
        b.textContent=d;
        b.addEventListener('click',()=>{ els.diamMm.value=d; update();});
        els.quickDia.appendChild(b);
    });

    function syncUnitBtns(){
        els.btnMetric.classList.toggle('is-on', units==='Metric');
        els.btnImperial.classList.toggle('is-on', units==='Imperial');
        els.btnMetric.setAttribute('aria-pressed', units==='Metric');
        els.btnImperial.setAttribute('aria-pressed', units==='Imperial');
    }
    els.btnMetric.addEventListener('click',()=>{units='Metric'; syncUnitBtns(); update();});
    els.btnImperial.addEventListener('click',()=>{units='Imperial'; syncUnitBtns(); update();});

    ['change','input'].forEach(evt=>{
        [els.material,els.toolMaterial,els.diamMm,els.flutes,els.rigidity,els.operation,els.rpm,els.aggr]
            .forEach(el=>el.addEventListener(evt,update));
    });

    // defaults
    els.material.value='Aluminum 6061';
    els.diamMm.value=3.175; els.flutes.value=1; els.rpm.value=12000; els.aggr.value=30;
    syncUnitBtns();

    function update(){
        const material=els.material.value, mat=MATERIAL_DB[material];
        const toolMaterial=els.toolMaterial.value;
        const diamMm=parseFloat(els.diamMm.value||0), flutes=parseInt(els.flutes.value||1);
        const rigidity=els.rigidity.value, operation=els.operation.value;
        const rpm=parseInt(els.rpm.value||0), aggr=parseInt(els.aggr.value||0);
        els.rpmPill.textContent=rpm; els.aggrPill.textContent=aggr;

        const diamIn=mmToIn(diamMm), sfm=(Math.PI*diamIn*rpm)/12;
        const isWood=mat.rpm_min!==undefined;
        let sfmMin=0, sfmMax=0;
        if(!isWood){ sfmMin=mat.sfm_min; sfmMax=mat.sfm_max; if(toolMaterial==='HSS') sfmMax*=0.85; else sfmMax*=1.15; }

        const fluteScale=(flutes===1)?1.0:(flutes===2?0.85:0.75);
        const rigidScale=(rigidity==='Rigid CNC')?1.15:1.0;
        const clMin=mat.chipload_mm_min*diameterScaleFactor(diamMm)*fluteScale*rigidScale*0.95;
        const clMax=mat.chipload_mm_max*diameterScaleFactor(diamMm)*fluteScale*rigidScale*1.05;
        const clChosen=clMin+(clMax-clMin)*(aggr/100);

        let feedMmMin=rpm*flutes*clChosen, rpmSuggested=rpm;
        if(isWood){
            if(rpm>mat.rpm_max) rpmSuggested=mat.rpm_max; else if(rpm<mat.rpm_min) rpmSuggested=mat.rpm_min;
            feedMmMin=rpmSuggested*flutes*clChosen;
        }
        else if(sfm>sfmMax){ rpmSuggested=Math.floor((sfmMax*12)/(Math.PI*diamIn)); feedMmMin=rpmSuggested*flutes*clChosen; }
        else if(sfm<sfmMin){ rpmSuggested=Math.ceil((sfmMin*12)/(Math.PI*diamIn)); feedMmMin=rpmSuggested*flutes*clChosen; }

        const dw=suggestionDocWoc(operation,rigidity);
        const docMm=dw.doc*diamMm*(0.8+(aggr/100)*0.4);
        const wocMm=(operation==='Slotting'?diamMm:dw.woc*diamMm)*(0.9+(aggr/100)*0.2);

        const chiploadDisplay=units==='Metric' ? (round(clChosen,3)+' mm/tooth') : (round(mmToIn(clChosen),4)+' in/tooth');
        const feedDisplay   =units==='Metric' ? (round(feedMmMin)+' mm/min')     : (round(feedMmMin/25.4)+' ipm');
        const docDisplay    =units==='Metric' ? (round(docMm,2)+' mm')           : (round(mmToIn(docMm),3)+' in');
        const wocDisplay    =units==='Metric' ? (round(wocMm,2)+' mm')           : (round(mmToIn(wocMm),3)+' in');

        els.chiploadOut.textContent=chiploadDisplay;
        els.feedOut.textContent=feedDisplay;
        els.sfmOut.textContent=round(sfm)+' SFM';
        els.sfmBand.textContent=isWood
            ? 'Wood is set by chipload; run '+mat.rpm_min+'–'+mat.rpm_max+' rpm'
            : 'Recommended: '+round(sfmMin)+'–'+round(sfmMax)+' SFM';

        if(rpmSuggested!==rpm){
            els.rpmSuggest.classList.remove('hidden');
            els.rpmSuggest.textContent=(isWood
                ? 'This RPM is outside the '+mat.rpm_min+'–'+mat.rpm_max+' rpm band bit makers chart wood at. '
                : 'This RPM puts surface speed outside the recommended band. ')
                +rpm+' rpm would be better at '+rpmSuggested+' rpm.';
        } else {
            els.rpmSuggest.classList.add('hidden'); els.rpmSuggest.textContent='';
        }

        els.docOut.textContent=docDisplay;
        els.wocOut.textContent=wocDisplay;
        els.wocSub.textContent = (operation === 'Slotting')
          ? 'Slotting uses full width'
          : (operation === 'Boring')
            ? 'Radial stepover per circular pass'
            : 'Fraction of diameter for side milling';

        els.ctxMaterial.textContent=material;
        els.ctxMatNote.textContent=mat.note;
        els.ctxTool.textContent=round(diamMm,3)+' mm, '+flutes+(flutes===1?' flute, ':' flutes, ')+toolMaterial;
        els.ctxMachine.textContent=rigidity;
        els.ctxOp.textContent=operation;

        const notes=[];
        notes.push(mat.note);
        if(material.toLowerCase().includes('aluminum')) notes.push('Use strong air blast; light mist or WD-40 reduces built-up edge.');
        if (operation === 'Slotting') {
          notes.push('Favor helical ramp entries; keep stepdowns smaller to maintain chip evacuation.');
        } else if (operation === 'Boring') {
          notes.push('Boring: use small radial stepover and light DOC; keep feed smooth during circular interpolation.');
        } else {
          notes.push('Side milling: aim for steady chip thickness; adjust WOC to avoid chatter/rubbing.');
        }
        if(isWood){
            notes.push('Dust instead of chips means the chipload is too small: the bit rubs, heats and dulls, and the wood scorches. Raise the feed before dropping the rpm.');
            if(toolMaterial==='HSS') notes.push('HSS dulls quickly in wood, fastest in plywood and MDF; the chart chiploads are for carbide.');
        }
        else if(toolMaterial==='HSS') notes.push('HSS heats faster—keep SFM modest and ensure chips (not dust) are produced.');
        else notes.push('Carbide tolerates higher SFM but still needs proper chipload to avoid rubbing.');
        els.notesList.innerHTML='';
        notes.forEach(n=>{ const li=document.createElement('li'); li.textContent=n; els.notesList.appendChild(li); });
    }

    function suggestionDocWoc(op,rig){
      const isRigid = (rig === 'Rigid CNC');
      if (op === 'Slotting') {
        return { doc: isRigid ? 0.5 : 0.2, woc: 1.0 };
      }
      if (op === 'Boring') {
        return { doc: isRigid ? 0.3 : 0.15, woc: isRigid ? 0.1 : 0.05 };
      }
      return { doc: isRigid ? 1.0 : 0.5, woc: isRigid ? 0.4 : 0.2 };
    }

    update();
})();
