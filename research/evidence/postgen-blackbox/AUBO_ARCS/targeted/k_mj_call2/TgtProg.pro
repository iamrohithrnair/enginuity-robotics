<?xml version="1.0" encoding="UTF-8"?>
<AuboProgram name="TgtProg" installation="TgtProg_ins" installationRelativePath="TgtProg_ins.ins" directory="/root/arcs_ws/program" createdIn="0.29.3-rc.10" lastSaveIn="0.29.3-rc.10" robotSerialNumber="RoboDK" crcValue="225635">
    <kinematics status="NOT_INITIALIZED" validChecksum="false">
        <theta value="3.14159265358979,-1.5707963267949,0,-1.5707963267949,0,0"/>
        <a value="0.0010004,0,0.647,0.601445091,0.000451803,-0.000785351"/>
        <d value="0.1632,0.201467966,-0.000167966,0.000167966,0.10373501,0.094884533"/>
        <alpha value="0,-1.5703531067949,3.13960138358979,3.13793245358979,-1.5694211267949,1.5774796767949"/>
        <jointChecksum value="0,0,0,0,0,0"/>
    </kinematics>
    <WaypointModel>
        <Waypoint name="Waypoint_0">
            <RobotPose pose="0, 0, 0, 0, 0, 0"/>
            <JointPositions angles="0.000000, -0.174533, 0.349066, 0.000000, 0.523599, 0.000000"/>
            <TcpOffset pose="0.000000, 0.000000, 0.000000, 0.000000, 0.000000, 0.000000"/>
            <Kinematics status="NOT_INITIALIZED" validChecksum="false">
                <theta value="0,0,0,0,0,0"/>
                <a value="0,0,0,0,0,0"/>
                <d value="0,0,0,0,0,0"/>
                <alpha value="0,0,0,0,0,0"/>
                <beta value="0,0,0,0,0,0"/>
                <jointChecksum value="beta_value"/>
            </Kinematics>
        </Waypoint>
    </WaypointModel>
    <TimerModel/>
    <VariableModel>
    </VariableModel>
    <SubProgModel/>
    <InitVariablesNode title="初始变量" id="5a921187-19c7-4df4-8f4f-f31e78de5857">
        <datamodel/>
    </InitVariablesNode>
    <MainProgramNode title="机器人编程" id="a3f2c9bf-9c63-46b9-90f2-44556f25e2a2">
        <datamodel>
            <Bool key="addBeforeStartSequence" value="false"/>
            <Bool key="loopForever" value="true"/>
        </datamodel>
        <children>
            <ScriptNode title="Func_lib.lua" id="bc8a3b76-d231-4536-b144-2c91074bfc45">
                <datamodel>
                    <Expression key="expression"/>
                    <String key="file_path" value="Func_lib.lua"/>
                    <Bool key="use_file" value="true"/>
                </datamodel>
            </ScriptNode>
        <MoveNode title="MoveJ" id="e443df78-9558-467f-9ba9-1faf7a024204">
            <datamodel>
                <Float64 key="blendRadius" value="0"/>
                <Feature key="feature" name="Base" id="23a7711a-8133-4876-b7eb-dcd9e87a1613"/>
                <Float64 key="jointAcceleration" value="1.200"/>
                <Float64 key="jointSpeed" value="0.750"/>
                <Float64 key="toolAcceleration" value="1.2"/>
                <Float64 key="toolSpeed" value="0.25"/>
                <String key="type" value="MOVE_J"/>
                <Bool key="useActiveTCP" value="true"/>
                <Bool key="useJoints" value="true"/>
            </datamodel>
            <children>
                <WaypointNode title="Waypoint_0" id="f7c1bd87-4da5-4709-9471-3d60c8a70639">
                    <datamodel>
                        <VectorDouble key="baseToFeature" value="0,0,0,0,0,0"/>
                        <Float64 key="blendRadius" value="0.02"/>
                        <String key="blendType" value="NO_BLEND"/>
                        <Float64 key="cartesianAcceleration" value="1.2"/>
                        <Float64 key="cartesianSpeed" value="0.25"/>
                        <Float64 key="jointAcceleration" value="1.200000"/>
                        <Float64 key="jointSpeed" value="0.750000"/>
                        <Float64 key="motionTime" value="0"/>
                        <String key="motionType" value="SHARED"/>
                        <String key="type" value="POSITION"/>
                        <String key="variableType" value="VARIABLE_POSE"/>
                        <Waypoint key="waypoint" name="Waypoint_0"/>
                    </datamodel>
                </WaypointNode>
            </children>
        </MoveNode>
            <CallNode title="Call fn" id="fcbd04c3-4021-4ef7-8ca5-a5a19e4d6e3c">
                <datamodel>
                    <SubProgram key="subprog" name="fn"/>
                </datamodel>
            </CallNode>
            <CallNode title="Call fn2" id="12e0c8b2-bad6-40fb-9948-8dec4f65d4d9">
                <datamodel>
                    <SubProgram key="subprog" name="fn2"/>
                </datamodel>
            </CallNode>
        </children>
    </MainProgramNode>

</AuboProgram>