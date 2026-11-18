// Cover, performance and closing layouts use the same palette and the same editable layer IDs.
export const weeklyStyles={
  'blue-score':{
    paper:'#183CA5',ink:'#F5F4DE',headline:'#FFF9E9',accent:'#9DD7F4',grain:48,motifName:'악보 선화',
    cover:{
      motif:{x:525,y:154,width:638,height:822},
      handle:{y:52,fontSize:26},topRule:{y:120,height:2},
      subtitle:{x:66,y:52,fontSize:26,family:'sans',weight:650},
      title:{x:65,y:189,fontSize:146,leading:1.04},
      bottomRule:{x:66,y:1007,width:948,height:2},
      date:{x:62,y:1039,fontSize:90,italic:true},
      count:{x:70,y:1222,fontSize:26,family:'sans',weight:600}
    },
    performance:{titleFamily:'serif',ruleHeight:2},
    closing:{
      motif:{x:540,y:156,width:645,height:822},
      profilePhoto:{x:67,y:56,width:136,height:136},
      handle:{x:227,y:100,width:750,fontSize:32,align:'left'},
      closingTitle:{x:66,y:344,width:800,fontSize:119,align:'left'},
      bottomRule:{x:66,y:1007,width:948,height:2},
      closingCopy:{x:66,y:1056,width:930,align:'left',fontSize:32}
    }
  },
  'stage-marquee':{
    paper:'#211B21',ink:'#F6E7D4',headline:'#FFD69A',accent:'#F7BE6C',grain:26,motifName:'극장 아치',
    defaultTitle:'공연이 있는\n일주일.',
    cover:{
      motif:{x:58,y:167,width:964,height:264},
      handle:{x:1014,y:57,fontSize:25},topRule:{y:119,height:2},
      subtitle:{x:66,y:56,fontSize:25,family:'sans',weight:650},
      title:{x:540,y:451,width:980,fontSize:111,leading:1.16,family:'sans',weight:800,align:'center'},
      bottomRule:{x:268,y:927,width:544,height:3},
      date:{x:540,y:971,width:950,fontSize:75,align:'center'},
      count:{x:540,y:1176,width:950,fontSize:29,family:'sans',weight:650,align:'center'}
    },
    performance:{titleFamily:'sans',ruleHeight:3},
    closing:{
      motif:{x:66,y:65,width:948,height:260},
      profilePhoto:{x:459,y:317,width:162,height:162},
      handle:{x:540,y:506,width:870,fontSize:34,align:'center'},
      closingTitle:{x:540,y:644,width:930,fontSize:96,family:'sans',align:'center'},
      bottomRule:{x:268,y:1008,width:544,height:3},
      closingCopy:{x:540,y:1060,width:916,fontSize:31,align:'center'}
    }
  },
  'matinee-program':{
    paper:'#F5EEDC',ink:'#263E33',headline:'#164739',accent:'#ED8055',grain:66,motifName:'꽃 목판화',
    defaultTitle:'공연이\n있는 일주일.',
    cover:{
      motif:{x:464,y:38,width:606,height:583},
      handle:{x:1014,y:1219,fontSize:24},topRule:{y:1150,height:2},
      subtitle:{x:70,y:244,fontSize:26,family:'sans',weight:650},
      title:{x:61,y:622,width:966,fontSize:124,leading:1.10},
      bottomRule:{x:71,y:187,width:106,height:5},
      date:{x:67,y:74,width:610,fontSize:49},
      count:{x:69,y:1216,width:500,fontSize:28,family:'sans',weight:650}
    },
    performance:{titleFamily:'serif',ruleHeight:3},
    closing:{
      motif:{x:493,y:46,width:550,height:529},
      profilePhoto:{x:70,y:106,width:150,height:150},
      handle:{x:70,y:292,width:590,fontSize:32,align:'left'},
      closingTitle:{x:64,y:557,width:928,fontSize:118,align:'left'},
      bottomRule:{x:69,y:1014,width:942,height:3},
      closingCopy:{x:69,y:1071,width:920,fontSize:32,align:'left'}
    }
  }
};
// An engraved ribbon, a lamp-lined proscenium, and a two-ink botanical print.
export const weeklyMotifs={
  'blue-score':{
    width:600,height:680,
    paths:Array.from({length:42},(_,i)=>{
      const t=i/41;
      return {
        d:`M${8+150*t} ${668-48*t}
           C${35+151*t} ${521-45*t} ${77+304*t} ${571+65*t} ${196+165*t} ${414+70*t}
           C${285+145*t} ${288+80*t} ${113-43*t} ${274+78*t} ${215-49*t} ${181+66*t}
           C${279-25*t} ${112+16*t} ${439+18*t} ${168-148*t} ${491+101*t} ${12+48*t}`,
        stroke:i%7===0?'#E0F4FC':'accent',strokeWidth:i%7===0?2.4:1.6,opacity:i%7===0?.95:.87
      };
    })
  },
  'stage-marquee':{
    width:948,height:260,
    paths:[
      // Stepped opening and the heavy velour lambrequin behind the gilded surround.
      {d:'M4 8H944V250H869C843 194 801 142 737 114C689 93 627 90 581 90L565 79H383L367 90C321 90 259 93 211 114C147 142 105 194 79 250H4Z',fill:'#5C2730'},
      {d:'M4 35H944V119C882 75 830 61 754 57L727 43H221L194 57C118 61 66 75 4 119Z',fill:'#7F3735'},
      {d:'M4 150C71 100 123 78 188 70C127 96 88 128 51 166L4 233ZM944 150C877 100 825 78 760 70C821 96 860 128 897 166L944 233Z',fill:'#391F29'},
      {d:'M5 12H943M5 24H943',stroke:'accent',strokeWidth:3},
      {d:'M5 32H173L182 27H766L775 32H943',stroke:'accent',strokeWidth:1.5,opacity:.78},
      // The overlapping archivolts carry one run of lamps, following the arch.
      {d:'M38 249C78 157 161 86 254 71C296 64 334 64 359 64L379 51H569L589 64C614 64 652 64 694 71C787 86 870 157 910 249',stroke:'accent',strokeWidth:2.4},
      {d:'M54 249C92 166 167 99 254 83C295 76 337 76 363 76L381 64H567L585 76C611 76 653 76 694 83C781 99 856 166 894 249',stroke:'#332129',strokeWidth:12},
      {d:'M74 250C110 175 179 116 257 100C297 92 339 91 369 91L385 80H563L579 91C609 91 651 92 691 100C769 116 838 175 874 250',stroke:'accent',strokeWidth:3.2},
      {d:'M86 250C122 184 183 129 258 112C300 103 343 102 371 102L389 91H559L577 102C605 102 648 103 690 112C765 129 826 184 862 250',stroke:'accent',strokeWidth:1.1,opacity:.65},
      {d:[[61,234],[76,208],[95,183],[118,158],[145,136],[175,117],[208,102],[243,91],[279,83],[316,79],[353,78],[395,65],[432,65]]
        .flatMap(([x,y])=>[x,948-x].map(cx=>`M${cx-3} ${y}a3 3 0 1 0 6 0a3 3 0 1 0-6 0Z`)).join(' '),fill:'#FFE2A0'},
      {d:'M463 62L474 54L485 62L474 70Z',fill:'accent'}
    ]
  },
  'matinee-program':{
    width:520,height:500,
    paths:[
      // Curved cut-paper stem with lobed leaves offset like a lithographic impression.
      {d:'M76 484C139 424 169 362 205 310C241 256 299 215 333 157L344 158C307 230 254 263 216 319C169 387 151 439 85 489Z',fill:'#214D3D'},
      {d:'M175 369C115 365 59 338 32 291C47 297 61 297 78 297C54 278 39 254 31 228C51 229 77 237 97 248C84 226 84 200 88 185C114 199 135 220 149 245C148 222 153 208 160 202C183 229 187 262 190 284C200 268 212 259 224 259C233 296 209 339 175 369Z',fill:'#245843'},
      {d:'M164 346C155 310 124 268 97 241',stroke:'#C1C29A',strokeWidth:2.4},
      {d:'M192 351C225 277 296 255 354 258C339 269 335 279 326 293C353 278 386 274 421 280C410 296 397 311 383 322C413 316 443 317 466 326C444 352 411 365 380 367C395 375 402 384 408 396C369 409 337 401 311 394C318 406 322 419 321 431C278 427 234 394 202 364Z',fill:'#184637'},
      {d:'M206 360C262 336 330 329 407 323M276 341Q294 317 309 304M314 335Q337 350 353 368',stroke:'#A7B68C',strokeWidth:2.1},
      {d:'M142 412C113 405 93 385 88 363C108 364 128 371 142 388C144 370 151 356 164 348C167 373 159 397 142 412Z',fill:'#84916B'},
      // An irregular poppy cone. The raised middle petal doubles as the second ink.
      {d:'M329 204C297 223 266 214 250 196C239 184 243 169 251 159C222 158 207 139 214 120C221 102 241 92 262 96C241 77 249 54 267 45C292 33 314 47 324 70C321 43 341 22 363 26C387 30 398 55 388 83C410 61 435 62 451 80C471 101 460 128 438 141C465 141 478 164 467 184C454 208 427 216 395 204C409 224 398 248 378 255C351 265 328 238 329 204Z',fill:'accent'},
      {d:'M339 161C302 155 270 137 268 115C266 95 289 85 306 94C309 71 330 66 343 76C360 88 357 112 353 127C368 110 388 104 401 115C416 130 403 154 379 166L355 176Z',fill:'#FAAF78'},
      {d:'M322 170C329 158 344 148 359 151C372 154 375 166 370 178C361 192 349 199 335 195C322 191 318 181 322 170Z',fill:'#283F30'},
      {d:'M320 168Q296 159 284 145M324 162Q300 143 296 131M331 157Q314 136 311 122M361 183Q384 184 402 174M355 190Q371 199 386 199',stroke:'#A44F36',strokeWidth:2.2},
      {d:'M331 174L337 168M341 183L347 177M354 171L359 166',stroke:'#F4CC90',strokeWidth:2.7}
    ]
  }
};
