// Derived metadata only; observations are not root-cause diagnoses.
export function summarizeDiagnostics(events){
 const counts={},errors=[],markers=[],transitions=[];
 events.forEach((row,index)=>{
  counts[row.event]=(counts[row.event]||0)+1;
  const ref={eventIndex:index,...row};
  if(row.event==='request.error'||row.event==='javascript.error')errors.push(ref);
  if(row.event==='user.problem')markers.push(ref);
  if(row.event==='workspace.state')transitions.push(ref);
 });
 return {
  eventCount:events.length,
  retainedWindow:{from:events[0]?.at??null,to:events.at(-1)?.at??null,earlierEventsMayBeMissing:true},
  countsByEvent:counts,
  errors,problemMarkers:markers,workspaceTransitions:transitions,
  latestWorkspace:transitions.at(-1)??null,
  readingNotes:[
   'Read summary first; eventIndex refers to the zero-based raw events array.',
   'request.response records response headers, not successful body parsing. HTTP 200 followed by request.error is a failed request.',
   'workspace.state online is application state; page online/offline reflects the browser network signal. Neither establishes a root cause.',
   'Pending edits are not proof of data loss. Absence of recovery in the retained window is not proof that recovery never occurred.',
   'Errors, markers and transitions are observations, not causal conclusions. Raw events remain in recorded order.'
  ]
 };
}
export function formatDiagnosticsReport(snapshot){
 const s=snapshot.summary??summarizeDiagnostics(snapshot.events);
 const lines=['# Spider reliability report',`Build: ${snapshot.build}`,`Exported: ${snapshot.exportedAt}`,`Retained events: ${s.eventCount}`,`Window: ${s.retainedWindow.from??'empty'} — ${s.retainedWindow.to??'empty'}`,'',snapshot.privacy,'','## Errors'];
 const row=e=>`- [event ${e.eventIndex}] ${e.at} ${e.event} ${JSON.stringify(Object.fromEntries(Object.entries(e).filter(([k])=>!['eventIndex','at','event'].includes(k))))}`;
 lines.push(...(s.errors.length?s.errors.map(row):['- None recorded in retained window.']),'','## Problem markers',...(s.problemMarkers.length?s.problemMarkers.map(row):['- None recorded.']),'','## Workspace transitions',...(s.workspaceTransitions.length?s.workspaceTransitions.map(row):['- None recorded.']),'','## Interpretation limits',...s.readingNotes.map(x=>'- '+x),'','Full raw events are preserved in Export JSON.');
 return lines.join('\n');
}
