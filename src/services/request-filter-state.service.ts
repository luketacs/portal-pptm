import { Injectable } from '@angular/core';
import { RequestStatus, MaterialType } from '../models/request.model';

export interface RequestFilterState {
  mode: string;
  searchQuery: string;
  statusFilter: RequestStatus | 'all';
  materialTypeFilter: MaterialType | 'all';
  materialCodeFilter: string;
  dateFrom: string;
  dateTo: string;
  currentPage: number;
}

@Injectable({ providedIn: 'root' })
export class RequestFilterStateService {
  private state: RequestFilterState | null = null;

  save(state: RequestFilterState): void {
    this.state = { ...state };
  }

  restore(mode: string): RequestFilterState | null {
    if (this.state && this.state.mode === mode) {
      return this.state;
    }
    return null;
  }

  clear(): void {
    this.state = null;
  }
}
