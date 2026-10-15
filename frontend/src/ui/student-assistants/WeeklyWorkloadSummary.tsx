import { weekRangeLabel } from '../../formatters/dateFormatter'
import { workloadHoursLabel } from '../../formatters/timeFormatter'
import type { WeeklyWorkload } from '../../formatters/weeklyWorkload'

interface WeeklyWorkloadSummaryProps {
  weekStart: Date
  rows: WeeklyWorkload[]
  ascending: boolean
  onSortChange: (ascending: boolean) => void
  onClose: () => void
}

export function WeeklyWorkloadSummary({ weekStart, rows, ascending, onSortChange, onClose }: WeeklyWorkloadSummaryProps) {
  return (
    <div className="sa-profile-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="sa-weekly-summary-dialog" role="dialog" aria-modal="true" aria-labelledby="sa-weekly-summary-title" onMouseDown={event => event.stopPropagation()}>
        <div className="sa-profile-heading">
          <div><h3 id="sa-weekly-summary-title">Weekly Summary</h3><small>{weekRangeLabel(weekStart)}</small></div>
          <button type="button" aria-label="Close" onClick={onClose}>×</button>
        </div>
        <label className="sa-workload-sort">
          Sort
          <select value={ascending ? 'ascending' : 'descending'} onChange={event => onSortChange(event.target.value === 'ascending')}>
            <option value="descending">Most workload first</option>
            <option value="ascending">Least workload first</option>
          </select>
        </label>
        <div className="sa-workload-table-scroll">
          <table className="sa-workload-table">
            <thead><tr><th scope="col">#</th><th scope="col">Student</th><th scope="col">Duty</th><th scope="col">Event overtime</th><th scope="col">Reliever overtime</th><th scope="col">Total</th></tr></thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={row.id}>
                  <td>{index + 1}</td>
                  <th scope="row">{row.name}</th>
                  <td>{workloadHoursLabel(row.dutyMinutes)}</td>
                  <td>{workloadHoursLabel(row.eventMinutes)}</td>
                  <td>{workloadHoursLabel(row.relieverMinutes)}</td>
                  <td className="sa-workload-total">{workloadHoursLabel(row.totalMinutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="sa-profile-actions"><button className="btn-secondary" type="button" onClick={onClose}>Close</button></div>
      </section>
    </div>
  )
}
