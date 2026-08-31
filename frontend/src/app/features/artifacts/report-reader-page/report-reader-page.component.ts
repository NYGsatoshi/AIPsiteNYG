import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, inject, signal, ViewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { LucideX, LucideFileText } from '@lucide/angular';

type Evidence={id:string;ordinal:number;sourceKind:string;sourceTitle:string|null;passage:string;location:string|null;traceEventId:string|null};
type Citation={id:string;ordinal:number;claimId:string;logicalClaimId:string;evidence:Evidence[]};
type Run={kind:'text'|'citation';text:string;citation:Citation|null};
type Section={id:string;logicalSectionId:string;ordinal:number;heading:string;runs:Run[]};
type Report={projectId:string;taskId:string|null;artifactId:string;artifactVersionId:string;versionNumber:number;title:string;sections:Section[]};

@Component({selector:'app-report-reader-page',standalone:true,imports:[LucideX, LucideFileText],templateUrl:'./report-reader-page.component.html',styleUrl:'./report-reader-page.component.scss'})
export class ReportReaderPageComponent {
 private readonly http=inject(HttpClient); private readonly route=inject(ActivatedRoute); private trigger:HTMLElement|null=null;
 readonly loading=signal(true); readonly error=signal(false); readonly report=signal<Report|null>(null); readonly selected=signal<Citation|null>(null);
 @ViewChild('inspector') inspector?:ElementRef<HTMLElement>;
 constructor(){const projectId=this.route.snapshot.paramMap.get('projectId'); const versionId=this.route.snapshot.paramMap.get('artifactVersionId'); const taskId=this.route.snapshot.paramMap.get('taskId'); const suffix=taskId?`?taskId=${encodeURIComponent(taskId)}`:''; this.http.get<Report>(`/api/projects/${projectId}/artifact-versions/${versionId}/report${suffix}`).subscribe({next:r=>{this.report.set(r);this.loading.set(false);},error:()=>{this.error.set(true);this.loading.set(false);}});}
 select(citation:Citation,event:Event){this.trigger=event.currentTarget as HTMLElement;this.selected.set(citation);queueMicrotask(()=>this.inspector?.nativeElement.focus());}
 close(){this.selected.set(null);queueMicrotask(()=>this.trigger?.focus());}
}
