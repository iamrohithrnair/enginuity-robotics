<?xml version="1.0" encoding="UTF-8"?>
<AuboProgram name="MainCall" installation="MainCall_ins" installationRelativePath="MainCall_ins.ins" directory="/root/arcs_ws/program" createdIn="0.29.3-rc.10" lastSaveIn="0.29.3-rc.10" robotSerialNumber="RoboDK" crcValue="225635">
    <kinematics status="NOT_INITIALIZED" validChecksum="false">
        <theta value="3.14159265358979,-1.5707963267949,0,-1.5707963267949,0,0"/>
        <a value="0.0010004,0,0.647,0.601445091,0.000451803,-0.000785351"/>
        <d value="0.1632,0.201467966,-0.000167966,0.000167966,0.10373501,0.094884533"/>
        <alpha value="0,-1.5703531067949,3.13960138358979,3.13793245358979,-1.5694211267949,1.5774796767949"/>
        <jointChecksum value="0,0,0,0,0,0"/>
    </kinematics>
    <WaypointModel>
        <Waypoint name="Waypoint_0">
            <RobotPose pose="0.426318, 0.020000, 0.422034, -2.879793, 0.872665, 3.141593"/>
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
        <Waypoint name="Waypoint_1">
            <RobotPose pose="0, 0, 0, 0, 0, 0"/>
            <JointPositions angles="0.349066, -0.174533, 0.349066, 0.000000, 0.523599, 0.000000"/>
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
    <InitVariablesNode title="初始变量" id="17e0aa3c-0398-4ca8-aa7e-9d498c778ea6">
        <datamodel/>
    </InitVariablesNode>
    <MainProgramNode title="机器人编程" id="b5d32b16-6619-4cb1-9710-37d1b83e90ec">
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
        <MoveNode title="MoveJ" id="23a7711a-8133-4876-b7eb-dcd9e87a1613">
            <datamodel>
                <Float64 key="blendRadius" value="0"/>
                <Feature key="feature" name="Base" id="1846d424-c17c-4279-a3c6-612f48268673"/>
                <Float64 key="jointAcceleration" value="1.200"/>
                <Float64 key="jointSpeed" value="0.750"/>
                <Float64 key="toolAcceleration" value="1.2"/>
                <Float64 key="toolSpeed" value="0.25"/>
                <String key="type" value="MOVE_J"/>
                <Bool key="useActiveTCP" value="true"/>
                <Bool key="useJoints" value="false"/>
            </datamodel>
            <children>
                <WaypointNode title="Waypoint_0" id="e443df78-9558-467f-9ba9-1faf7a024204">
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
            <CallNode title="Call SubProg2" id="b4862b21-fb97-4435-8856-1712e8e5216a">
                <datamodel>
                    <SubProgram key="subprog" name="SubProg2"/>
                </datamodel>
            </CallNode>
            <CallNode title="Call NotAProgram" id="5487ce1e-af19-422a-99b8-a714e61a441c">
                <datamodel>
                    <SubProgram key="subprog" name="NotAProgram"/>
                </datamodel>
            </CallNode>
        </children>
    </MainProgramNode>
            <SubProgNode title="SubProg2" id="a3f2c9bf-9c63-46b9-90f2-44556f25e2a2">
                <datamodel>
                    <String key="filePath" value="SubProg2.pro"/>
                    <Bool key="hasload" value="true"/>
                    <Bool key="keepUpdate" value="true"/>
                    <SubProgram key="subProg" name="SubProg2"/>
                </datamodel>
                <children>
        <MoveNode title="MoveJ" id="85776e9a-dd84-439e-b154-5a137a1d5006">
            <datamodel>
                <Float64 key="blendRadius" value="0.001000"/>
                <Feature key="feature" name="Base" id="eb2083e6-ce16-4dba-8ff1-8e0242af9fc3"/>
                <Float64 key="jointAcceleration" value="1.200"/>
                <Float64 key="jointSpeed" value="0.750"/>
                <Float64 key="toolAcceleration" value="1.2"/>
                <Float64 key="toolSpeed" value="0.25"/>
                <String key="type" value="MOVE_J"/>
                <Bool key="useActiveTCP" value="true"/>
                <Bool key="useJoints" value="true"/>
            </datamodel>
            <children>
                <WaypointNode title="Waypoint_1" id="8d723104-f773-43c1-b458-a748e9bb17bc">
                    <datamodel>
                        <VectorDouble key="baseToFeature" value="0,0,0,0,0,0"/>
                        <Float64 key="blendRadius" value="0.001000"/>
                        <String key="blendType" value="WAYPOINT_BLEND"/>
                        <Float64 key="cartesianAcceleration" value="1.2"/>
                        <Float64 key="cartesianSpeed" value="0.25"/>
                        <Float64 key="jointAcceleration" value="1.200000"/>
                        <Float64 key="jointSpeed" value="0.750000"/>
                        <Float64 key="motionTime" value="0"/>
                        <String key="motionType" value="SHARED"/>
                        <String key="type" value="POSITION"/>
                        <String key="variableType" value="VARIABLE_POSE"/>
                        <Waypoint key="waypoint" name="Waypoint_1"/>
                    </datamodel>
                </WaypointNode>
            </children>
        </MoveNode>
            </children>
        </SubProgNode>

</AuboProgram>