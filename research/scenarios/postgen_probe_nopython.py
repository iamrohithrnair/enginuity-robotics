




import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), os.pardir, os.pardir, "python", "enginuity", "src"))  
from enginuity import robolink, robomath
RDK = robolink.Robolink(port=20524, args=[], quit_on_close=False)
print('show0', RDK.Command('ProgramsShow','0'), 'popups0', RDK.Command('Popups','0'))
RDK.AddStation('NoPython')
robot = RDK.AddFile('/workspace/src/AI/experiments/Robocraft/data/library/files/library-robots/ABB-IRB-120-3-0-6.robot')  
robot.setJoints([0,-10,20,0,30,0])
frame = RDK.AddFrame('F1')
t1 = RDK.AddTarget('T1', frame, robot)
prog = RDK.AddProgram('NoPyProg', robot)
prog.setPoseFrame(frame)
prog.MoveJ(t1)
try:
    print('make', prog.MakeProgram(sys.argv[1]))
except Exception as e:
    print('make ERROR', type(e).__name__, str(e)[:300])
print('files', os.listdir(sys.argv[1]))
