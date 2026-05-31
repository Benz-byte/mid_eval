"""
Solver routes for the Automated Laboratory Scheduling System.

Exposes two endpoints:
    POST /run    - Trigger the CP-SAT solver with current database data
    GET  /status - Check the current solver state (idle, running, done)

The solver state is stored in memory so the frontend can poll it
to show a loading indicator while the solver is running.
"""

from flask import Blueprint, jsonify
import database as db
from solver.cpsat_solver import run_cpsat_solver

solver_bp = Blueprint('solver', __name__)

# In-memory solver state tracked between requests
_solver_state = {'state': 'idle', 'message': 'Solver is ready'}


@solver_bp.route('/run', methods=['POST'])
def run_solver():
    """
    Trigger the CP-SAT solver using all current data from the database.

    Fetches subjects, rooms, instructors, timeslots, availability windows,
    and preferred time slots, then passes them all to the solver.

    If the solver succeeds, the generated schedule is saved to the database.
    If it fails (infeasible or error), the existing schedule is left unchanged.

    Returns the solver result including status, message, and assignments.
    """
    global _solver_state
    _solver_state = {'state': 'running', 'message': 'Solver is running...'}
    try:
        result = run_cpsat_solver(
            db.get_all_subjects(),
            db.get_all_rooms(),
            db.get_all_instructors(),
            db.get_all_instructor_subjects(),
            db.get_all_timeslots(),
            db.get_instructor_availability(),
            db.get_preferred_time_slots(),
        )

        if result['status'] == 'success':
            db.save_schedule(result['assignments'])

        _solver_state = {'state': 'done', 'message': result.get('message', 'Done')}
        return jsonify(result)

    except Exception as error:
        _solver_state = {'state': 'idle', 'message': 'Solver encountered an error'}
        return jsonify({'status': 'error', 'message': str(error), 'assignments': []})


@solver_bp.route('/status', methods=['GET'])
def solver_status():
    """Return the current solver state for frontend polling."""
    return jsonify(_solver_state)
